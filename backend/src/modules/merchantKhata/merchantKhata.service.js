import { supabaseAdmin } from '../../lib/supabase.js';
import { conflict, internal, notFound, unprocessable } from '../../lib/errors.js';
import { khataAgeing, localDate, addDays } from '../../lib/khataAgeing.js';
import { logger } from '../../lib/logger.js';
import * as notifications from '../notifications/notification.service.js';
import {
  ACCOUNT_COLUMNS,
  TXN_COLUMNS,
  toPublicAccount,
  toPublicTransaction,
  aggregates,
  transactions,
} from '../khata/khata.service.js';

/**
 * The merchant's khata — roadmap §4 P2 Digital Khata, statements, due dates &
 * reminders, audit-safe records; §6 Khata flow.
 *
 * Writes go through record_khata_entry (migration 0037), which locks the
 * account, refuses an edit in all but name, and makes a correction a reversal
 * entry linked to what it corrects. Reminders are their own rows: chasing a
 * payment never touches the ledger. `store` is the caller's own store
 * (requireStoreOwner), and an account is only ever looked up within it.
 */

const fail = (error, message) => {
  if (error) throw internal(message);
};

async function customersByIds(ids) {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabaseAdmin.from('customers').select('id, full_name, phone, email').in('id', ids);
  fail(error, 'Could not load the customers.');
  return new Map((data ?? []).map((row) => [row.id, row]));
}

const toCustomer = (row) =>
  row ? { id: row.id, name: row.full_name ?? null, phone: row.phone ?? null, email: row.email ?? null } : null;

async function findStoreAccount(store, accountId) {
  const { data, error } = await supabaseAdmin
    .from('khata_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', accountId)
    .eq('store_id', store.id)
    .maybeSingle();
  fail(error, 'Could not load the khata account.');
  if (!data) throw notFound('Khata account');
  return data;
}

async function entriesFor(accountIds) {
  if (accountIds.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('khata_transactions')
    .select('id, account_id, type, amount_paise, due_date, occurred_at, created_at')
    .in('account_id', accountIds);
  fail(error, 'Could not load the khata entries.');
  const byAccount = new Map();
  for (const row of data ?? []) {
    if (!byAccount.has(row.account_id)) byAccount.set(row.account_id, []);
    byAccount.get(row.account_id).push(row);
  }
  return byAccount;
}

function merchantAccountView(row, customer, ageing) {
  return {
    ...toPublicAccount(row),
    customer: toCustomer(customer),
    notes: row.notes ?? null,
    remindersEnabled: row.reminders_enabled ?? true,
    ageing,
  };
}

/** Every account at the store, with what is outstanding and overdue on each. */
export async function listAccounts(store, { search, status = 'all', now = new Date() } = {}) {
  const { data, error } = await supabaseAdmin
    .from('khata_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('store_id', store.id)
    .order('updated_at', { ascending: false });
  fail(error, 'Could not load the khata.');

  const rows = data ?? [];
  const [customers, entries] = await Promise.all([
    customersByIds([...new Set(rows.map((row) => row.customer_id))]),
    entriesFor(rows.map((row) => row.id)),
  ]);
  const today = localDate(now, store.timezone);

  let accounts = rows.map((row) => {
    const ageing = khataAgeing(entries.get(row.id) ?? [], today);
    return merchantAccountView(row, customers.get(row.customer_id), {
      outstandingPaise: ageing.outstandingPaise,
      overduePaise: ageing.overduePaise,
      advancePaise: ageing.advancePaise,
      earliestDueDate: ageing.earliestDueDate,
    });
  });

  if (search) {
    const term = search.toLowerCase();
    accounts = accounts.filter(
      (account) =>
        account.customer?.name?.toLowerCase().includes(term) ||
        account.customer?.phone?.includes(term) ||
        account.customer?.email?.toLowerCase().includes(term),
    );
  }
  if (status === 'outstanding') accounts = accounts.filter((a) => a.ageing.outstandingPaise > 0);
  if (status === 'overdue') accounts = accounts.filter((a) => a.ageing.overduePaise > 0);

  return {
    accounts,
    summary: {
      accountCount: accounts.length,
      outstandingPaise: accounts.reduce((sum, a) => sum + a.ageing.outstandingPaise, 0),
      overduePaise: accounts.reduce((sum, a) => sum + a.ageing.overduePaise, 0),
    },
  };
}

/**
 * Finds the customer a khata is being opened for. Only someone who has
 * ordered from this store, or whose email or phone the merchant already knows
 * exactly, can be found — the lookup never lists or searches other people.
 */
async function resolveCustomer(store, { customerId, email, phone }) {
  if (customerId) {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('customer_id')
      .eq('store_id', store.id)
      .eq('customer_id', customerId)
      .limit(1);
    fail(error, 'Could not find the customer.');
    if ((data ?? []).length === 0) throw notFound('Customer');
    return customerId;
  }

  let query = supabaseAdmin.from('customers').select('id');
  query = email ? query.eq('email', email.toLowerCase()) : query.eq('phone', phone);
  const { data, error } = await query.limit(2);
  fail(error, 'Could not find the customer.');
  if ((data ?? []).length !== 1) {
    throw unprocessable(
      'CUSTOMER_NOT_FOUND',
      'No single CPSE customer has that email or phone. Ask them to sign up, or check the number.',
    );
  }
  // A shop account is not a customer.
  const { data: merchant } = await supabaseAdmin.from('merchants').select('id').eq('id', data[0].id).maybeSingle();
  if (merchant) throw unprocessable('CUSTOMER_NOT_FOUND', 'That is a shop account, not a customer.');
  return data[0].id;
}

export async function openAccount(store, merchant, input) {
  const customerId = await resolveCustomer(store, input);

  const { data, error } = await supabaseAdmin
    .from('khata_accounts')
    .insert({
      customer_id: customerId,
      store_id: store.id,
      credit_limit_paise: input.creditLimitPaise ?? null,
      notes: input.notes ?? null,
      opened_by: merchant.id,
    })
    .select(ACCOUNT_COLUMNS)
    .maybeSingle();
  if (error?.code === '23505') throw conflict('This customer already has a khata at this store.');
  fail(error, 'Could not open the khata.');

  return getAccount(store, data.id);
}

export async function updateAccount(store, accountId, input) {
  await findStoreAccount(store, accountId);
  const patch = {};
  if (input.creditLimitPaise !== undefined) patch.credit_limit_paise = input.creditLimitPaise;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.remindersEnabled !== undefined) patch.reminders_enabled = input.remindersEnabled;

  const { error } = await supabaseAdmin.from('khata_accounts').update(patch).eq('id', accountId).eq('store_id', store.id);
  fail(error, 'Could not update the khata.');
  return getAccount(store, accountId);
}

async function remindersFor(accountId) {
  const { data, error } = await supabaseAdmin
    .from('khata_reminders')
    .select('id, outstanding_paise, overdue_paise, earliest_due_date, channel, sent_by_type, note, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(20);
  fail(error, 'Could not load reminders.');
  return (data ?? []).map((row) => ({
    id: row.id,
    outstandingPaise: row.outstanding_paise,
    overduePaise: row.overdue_paise,
    earliestDueDate: row.earliest_due_date ?? null,
    channel: row.channel,
    sentBy: row.sent_by_type,
    note: row.note ?? null,
    sentAt: row.created_at,
  }));
}

export async function getAccount(store, accountId, { page = 1, limit = 50, now = new Date() } = {}) {
  const row = await findStoreAccount(store, accountId);
  const [customers, entries, totals, ledger, reminders] = await Promise.all([
    customersByIds([row.customer_id]),
    entriesFor([row.id]),
    aggregates(row.id),
    transactions(row.id, { page, limit }),
    remindersFor(row.id),
  ]);
  const ageing = khataAgeing(entries.get(row.id) ?? [], localDate(now, store.timezone));

  return {
    account: merchantAccountView(row, customers.get(row.customer_id), {
      outstandingPaise: ageing.outstandingPaise,
      overduePaise: ageing.overduePaise,
      advancePaise: ageing.advancePaise,
      earliestDueDate: ageing.earliestDueDate,
    }),
    totals: {
      debitPaise: totals.debitPaise,
      creditPaise: totals.creditPaise,
      balancePaise: row.balance_paise,
    },
    openCharges: ageing.openCharges,
    transactions: ledger.transactions,
    total: ledger.total,
    reminders,
  };
}

const ENTRY_ERRORS = {
  ACCOUNT_NOT_FOUND: () => notFound('Khata account'),
  ENTRY_NOT_FOUND: () => notFound('Khata entry'),
  ORDER_NOT_FOUND: () => notFound('Order'),
  ACCOUNT_CLOSED: () => conflict('This khata is closed. Reopen it to add a charge.'),
  ALREADY_REVERSED: () => conflict('This entry has already been reversed.'),
  CANNOT_REVERSE_REVERSAL: () =>
    unprocessable('CANNOT_REVERSE_REVERSAL', 'A correction cannot itself be reversed. Record a new entry instead.'),
  REASON_REQUIRED: () => unprocessable('REASON_REQUIRED', 'Say why — corrections and adjustments need a reason.'),
};

async function record(store, merchant, accountId, payload, idempotencyKey) {
  const { data, error } = await supabaseAdmin.rpc('record_khata_entry', {
    payload: {
      account_id: accountId,
      store_id: store.id,
      merchant_id: merchant.id,
      idempotency_key: idempotencyKey,
      ...payload,
    },
  });
  if (error) {
    const code = Object.keys(ENTRY_ERRORS).find((name) => (error.message ?? '').includes(name));
    if (code) throw ENTRY_ERRORS[code]();
    logger.error('record_khata_entry failed', { code: error.code, message: error.message });
    throw internal('Could not record the khata entry.');
  }
  return data;
}

async function loadTransaction(id) {
  const { data, error } = await supabaseAdmin.from('khata_transactions').select(TXN_COLUMNS).eq('id', id).maybeSingle();
  fail(error, 'Could not load the khata entry.');
  return toPublicTransaction(data);
}

async function tellCustomer(store, accountId, title, body) {
  const { data: account } = await supabaseAdmin
    .from('khata_accounts')
    .select('id, customer_id')
    .eq('id', accountId)
    .maybeSingle();
  if (!account) return;
  await notifications.emit(account.customer_id, {
    type: 'khata_updated',
    title,
    body,
    payload: { account_id: accountId, store_id: store.id },
  });
}

const rupees = (paise) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Charge, payment or adjustment. */
export async function addEntry(store, merchant, accountId, input, { idempotencyKey = null, now = new Date() } = {}) {
  await findStoreAccount(store, accountId);

  const dueDate =
    input.kind === 'charge' ? (input.dueDate ?? addDays(localDate(now, store.timezone), store.khata_due_days ?? 30)) : null;

  const result = await record(
    store,
    merchant,
    accountId,
    {
      entry_kind: input.kind,
      direction: input.direction ?? null,
      amount_paise: input.amountPaise,
      description: input.description ?? null,
      due_date: dueDate,
      payment_method: input.paymentMethod ?? null,
      order_id: input.orderId ?? null,
    },
    idempotencyKey,
  );

  const transaction = await loadTransaction(result.transaction_id);
  if (!result.replayed) {
    const what =
      input.kind === 'charge'
        ? `${store.name} added ${rupees(input.amountPaise)} to your khata`
        : input.kind === 'payment'
          ? `${store.name} recorded your payment of ${rupees(input.amountPaise)}`
          : `${store.name} adjusted your khata by ${rupees(input.amountPaise)}`;
    await tellCustomer(store, accountId, what, input.description ?? null);
  }
  return { transaction, replayed: Boolean(result.replayed), account: (await getAccount(store, accountId)).account };
}

/** The correction: a new entry that cancels one already recorded. */
export async function reverseEntry(store, merchant, accountId, transactionId, { reason }) {
  await findStoreAccount(store, accountId);
  const result = await record(store, merchant, accountId, {
    entry_kind: 'reversal',
    reverses_transaction_id: transactionId,
    description: reason,
  });
  const transaction = await loadTransaction(result.transaction_id);
  await tellCustomer(store, accountId, `${store.name} corrected an entry in your khata`, reason);
  return { transaction, account: (await getAccount(store, accountId)).account };
}

/**
 * A reminder: a snapshot of what is owed, recorded, and sent to the customer
 * in the app. Refused when nothing is outstanding or the customer opted out.
 */
export async function sendReminder(store, merchant, accountId, { note = null, now = new Date() } = {}) {
  const view = await getAccount(store, accountId, { now });
  if (view.account.ageing.outstandingPaise <= 0) {
    throw unprocessable('NOTHING_OUTSTANDING', 'Nothing is outstanding on this khata.');
  }
  if (!view.account.remindersEnabled) {
    throw unprocessable('REMINDERS_OFF', 'Reminders are switched off for this customer.');
  }

  const { data, error } = await supabaseAdmin
    .from('khata_reminders')
    .insert({
      account_id: accountId,
      outstanding_paise: view.account.ageing.outstandingPaise,
      overdue_paise: view.account.ageing.overduePaise,
      earliest_due_date: view.account.ageing.earliestDueDate,
      channel: 'in_app',
      sent_by_type: merchant ? 'merchant' : 'system',
      sent_by_id: merchant?.id ?? null,
      note,
    })
    .select('id, created_at')
    .maybeSingle();
  fail(error, 'Could not record the reminder.');

  await notifications.emit(view.account.customer?.id ?? null, {
    type: 'khata_reminder',
    title: `Reminder from ${store.name}: ${rupees(view.account.ageing.outstandingPaise)} due on your khata`,
    body:
      view.account.ageing.overduePaise > 0
        ? `${rupees(view.account.ageing.overduePaise)} of it is past its due date.${note ? ` ${note}` : ''}`
        : (note ?? null),
    payload: { account_id: accountId, store_id: store.id },
  });

  return { reminder: { id: data.id, sentAt: data.created_at }, account: view.account };
}

export async function statement(store, accountId, { from, to, page, limit }) {
  const row = await findStoreAccount(store, accountId);
  const [totals, ledger] = await Promise.all([aggregates(row.id, { from, to }), transactions(row.id, { from, to, page, limit })]);
  return {
    account: toPublicAccount(row),
    period: { from: from ?? null, to: to ?? null },
    totals,
    transactions: ledger.transactions,
    total: ledger.total,
  };
}

export async function updateSettings(store, { khataEnabled, khataDueDays }) {
  const patch = {};
  if (khataEnabled !== undefined) patch.khata_enabled = khataEnabled;
  if (khataDueDays !== undefined) patch.khata_due_days = khataDueDays;
  const { data, error } = await supabaseAdmin
    .from('stores')
    .update(patch)
    .eq('id', store.id)
    .select('khata_enabled, khata_due_days')
    .maybeSingle();
  fail(error, 'Could not save the khata settings.');
  return { khataEnabled: data.khata_enabled, khataDueDays: data.khata_due_days };
}

/** The automatic reminder sweep: overdue accounts, at most one reminder a week each. */
export async function remindOverdue(store, { now = new Date() } = {}) {
  const { accounts } = await listAccounts(store, { status: 'overdue', now });
  let sent = 0;
  for (const account of accounts) {
    if (!account.remindersEnabled) continue;
    const { data: recent } = await supabaseAdmin
      .from('khata_reminders')
      .select('id, created_at')
      .eq('account_id', account.id)
      .gte('created_at', new Date(now.getTime() - 7 * 86_400_000).toISOString())
      .limit(1);
    if ((recent ?? []).length > 0) continue;
    try {
      await sendReminder(store, null, account.id, { now });
      sent += 1;
    } catch (error) {
      logger.warn('Automatic khata reminder skipped', { accountId: account.id, reason: error?.message });
    }
  }
  return sent;
}
