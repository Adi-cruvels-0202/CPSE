import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, notFound } from '../../lib/errors.js';

/**
 * Khata — the store-credit ledger. Checklist 9.6 – 9.9.
 *
 * READ-ONLY, three times over:
 *   1. this module exports no writer, and the router mounts no write verb;
 *   2. RLS grants the customer `select` on both tables and nothing else
 *      (migration 0018), so a write is refused even if the API tried;
 *   3. `khata_transactions` rows are immutable by trigger, and the account
 *      balance is maintained from the ledger rather than written (D16).
 *
 * Merchant-side khata administration is out of scope, so rows arrive as seed
 * data or from whatever the merchant side does directly to the database.
 *
 * Authorisation (9.6): an account is reachable only through `customer_id` taken
 * from the verified JWT. Another customer's account id is a 404, never a 403.
 */

const ACCOUNT_COLUMNS = 'id, customer_id, store_id, balance_paise, created_at, updated_at';
const TXN_COLUMNS = 'id, account_id, type, amount_paise, description, order_id, occurred_at, created_at';

const fail = (error, message) => {
  if (error) throw internal(message);
};

/**
 * Positive `balance_paise` means the customer owes the store. The API returns
 * both the raw signed number and an explicit `outstandingPaise`, so a client
 * never has to know which way the sign points to show "you owe ₹x".
 */
export function toPublicAccount(row, store = null) {
  return {
    id: row.id,
    storeId: row.store_id,
    store: store
      ? { id: store.id, slug: store.slug, name: store.name, logoUrl: store.logo_url ?? null }
      : null,
    balancePaise: row.balance_paise,
    outstandingPaise: Math.max(row.balance_paise, 0),
    // The store owes the customer — an overpayment or a refund into the khata.
    creditPaise: Math.max(-row.balance_paise, 0),
    isSettled: row.balance_paise === 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const toPublicTransaction = (row) => ({
  id: row.id,
  type: row.type,
  amountPaise: row.amount_paise,
  // Signed, so a client can render a running ledger without a branch.
  signedAmountPaise: row.type === 'debit' ? row.amount_paise : -row.amount_paise,
  description: row.description ?? null,
  orderId: row.order_id ?? null,
  occurredAt: row.occurred_at,
});

async function storesByIds(storeIds) {
  if (storeIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('stores')
    .select('id, slug, name, logo_url')
    .in('id', storeIds);

  fail(error, 'Could not load your khata.');
  return new Map((data ?? []).map((store) => [store.id, store]));
}

/**
 * Checklist 9.6. Every account this customer is authorised to see — which is
 * exactly the accounts whose `customer_id` is theirs. There is no sharing
 * model: a khata is between one customer and one store.
 */
export async function listAccounts(customerId) {
  const { data, error } = await supabaseAdmin
    .from('khata_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('customer_id', customerId)
    .order('updated_at', { ascending: false });

  fail(error, 'Could not load your khata.');

  const rows = data ?? [];
  const stores = await storesByIds(rows.map((row) => row.store_id));
  const accounts = rows.map((row) => toPublicAccount(row, stores.get(row.store_id) ?? null));

  return {
    accounts,
    // The figure a "my khata" screen leads with.
    totalOutstandingPaise: accounts.reduce((sum, account) => sum + account.outstandingPaise, 0),
  };
}

/** Ownership gate for everything below. A foreign account id is a 404. */
async function findOwnedAccount(customerId, accountId) {
  const { data, error } = await supabaseAdmin
    .from('khata_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', accountId)
    .eq('customer_id', customerId)
    .maybeSingle();

  fail(error, 'Could not load the khata account.');
  if (!data) throw notFound('Khata account');
  return data;
}

async function aggregates(accountId, { from = null, to = null } = {}) {
  const { data, error } = await supabaseAdmin.rpc('khata_statement', {
    p_account_id: accountId,
    p_from: from ?? null,
    p_to: to ?? null,
  });

  fail(error, 'Could not total up your khata.');

  // The function returns one row; supabase-js hands back either the row or a
  // single-element array depending on how it is declared.
  const row = Array.isArray(data) ? data[0] : data;
  return {
    openingPaise: row?.opening_paise ?? 0,
    debitPaise: row?.debit_paise ?? 0,
    creditPaise: row?.credit_paise ?? 0,
    closingPaise: row?.closing_paise ?? 0,
    transactionCount: row?.txn_count ?? 0,
  };
}

async function transactions(accountId, { from = null, to = null, page = 1, limit = 20 }) {
  let query = supabaseAdmin
    .from('khata_transactions')
    .select(TXN_COLUMNS, { count: 'exact' })
    .eq('account_id', accountId);

  if (from) query = query.gte('occurred_at', from);
  if (to) query = query.lte('occurred_at', to);

  const offset = (page - 1) * limit;
  const { data, count, error } = await query
    .order('occurred_at', { ascending: false })
    .range(offset, offset + limit - 1);

  fail(error, 'Could not load your khata transactions.');

  const rows = data ?? [];
  return { transactions: rows.map(toPublicTransaction), total: count ?? rows.length };
}

/**
 * Checklist 9.7. Opening balance, what is outstanding now, and the entries that
 * explain the difference.
 *
 * `openingPaise` here is the balance before the account's first entry, which is
 * 0 for an account that started empty and non-zero only for one migrated in
 * with history. The period-scoped version is what `statement` gives.
 */
export async function getAccount(customerId, accountId, { page = 1, limit = 20 } = {}) {
  const account = await findOwnedAccount(customerId, accountId);

  const [stores, totals, ledger] = await Promise.all([
    storesByIds([account.store_id]),
    aggregates(accountId),
    transactions(accountId, { page, limit }),
  ]);

  return {
    account: toPublicAccount(account, stores.get(account.store_id) ?? null),
    totals: {
      openingPaise: totals.openingPaise,
      debitPaise: totals.debitPaise,
      creditPaise: totals.creditPaise,
      // Comes from the trigger-maintained column, not from re-adding the
      // ledger: if those two ever disagree, the balance the store acts on is
      // the one to show.
      outstandingPaise: Math.max(account.balance_paise, 0),
      balancePaise: account.balance_paise,
    },
    transactions: ledger.transactions,
    total: ledger.total,
  };
}

/**
 * Checklist 9.8. The same ledger, bounded by a period, with the opening and
 * closing balances for that window — what a customer would hand to the store to
 * argue about a figure.
 */
export async function getStatement(customerId, accountId, { from, to, page, limit }) {
  const account = await findOwnedAccount(customerId, accountId);

  const [stores, totals, ledger] = await Promise.all([
    storesByIds([account.store_id]),
    aggregates(accountId, { from, to }),
    transactions(accountId, { from, to, page, limit }),
  ]);

  return {
    account: toPublicAccount(account, stores.get(account.store_id) ?? null),
    period: { from: from ?? null, to: to ?? null },
    totals: {
      openingPaise: totals.openingPaise,
      debitPaise: totals.debitPaise,
      creditPaise: totals.creditPaise,
      closingPaise: totals.closingPaise,
      transactionCount: totals.transactionCount,
    },
    transactions: ledger.transactions,
    total: ledger.total,
  };
}
