/**
 * The merchant-run khata against real Postgres (migration 0037), and its link
 * to orders and refunds (0038). Roadmap §4 P2 Digital Khata, statements, due
 * dates & reminders, audit-safe records, Khata refund/adjustment link; §6 Khata.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', async () => {
  const { createPgSupabase } = await import('../helpers/pgSupabase.js');
  return createPgSupabase();
});

const { resetDatabase, sql } = await import('../helpers/pgSupabase.js');
const { khataAgeing } = await import('../../src/lib/khataAgeing.js');
const flow = await import('./flow.js');
const { call, expectStatus } = flow;

beforeEach(async () => {
  await resetDatabase();
});

async function shopWithCustomerAccount({ creditLimitPaise = 50000 } = {}) {
  const shop = await flow.openShop();
  await flow.publish(shop);
  const customer = await flow.newCustomer();
  const [{ email }] = await sql('select email from customers where id = $1', [customer.id]);
  const opened = expectStatus(
    await call('post', `/merchant/stores/${shop.store.id}/khata`, shop.merchant, { email, creditLimitPaise }),
    201,
  );
  return { shop, customer, account: opened.account };
}

const entry = (shop, accountId, body, key) =>
  call('post', `/merchant/stores/${shop.store.id}/khata/${accountId}/entries`, shop.merchant, body, key ? { 'Idempotency-Key': key } : {});

describe('merchant khata ledger', () => {
  it('records charges and payments; the balance and statement follow the ledger; the customer sees the same', async () => {
    const { shop, customer, account } = await shopWithCustomerAccount();

    expectStatus(await entry(shop, account.id, { kind: 'charge', amountPaise: 30000, description: 'Monthly groceries' }), 201);
    const paid = expectStatus(await entry(shop, account.id, { kind: 'payment', amountPaise: 12000, paymentMethod: 'upi' }), 201);
    expect(paid.account.balancePaise).toBe(18000);
    expect(paid.account.ageing.outstandingPaise).toBe(18000);

    const view = expectStatus(await call('get', `/merchant/stores/${shop.store.id}/khata/${account.id}`, shop.merchant), 200);
    expect(view.totals).toMatchObject({ debitPaise: 30000, creditPaise: 12000, balancePaise: 18000 });
    expect(view.transactions.map((t) => t.entryKind)).toEqual(['payment', 'charge']);
    expect(view.transactions[1].dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(view.transactions[0].recordedBy).toBe('merchant');

    const mine = expectStatus(await call('get', `/khata/${account.id}`, customer.auth), 200);
    expect(mine.account.balancePaise).toBe(18000);
    expect(mine.ageing.outstandingPaise).toBe(18000);
    expect(mine.transactions.map((t) => t.entryLabel)).toEqual(['Payment received', 'Purchase on credit']);

    const notes = await sql(`select count(*)::int as n from notifications where customer_id = $1 and type = 'khata_updated'`, [customer.id]);
    expect(notes[0].n).toBe(2);
  });

  it('a retried entry with the same Idempotency-Key is recorded once', async () => {
    const { shop, account } = await shopWithCustomerAccount();
    const first = expectStatus(await entry(shop, account.id, { kind: 'charge', amountPaise: 5000 }, 'k-1'), 201);
    const second = expectStatus(await entry(shop, account.id, { kind: 'charge', amountPaise: 5000 }, 'k-1'), 201);
    expect(second.replayed).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect((await sql('select balance_paise from khata_accounts where id = $1', [account.id]))[0].balance_paise).toBe(5000);
  });

  it('corrects a mistake with a linked reversal — never an edit — and only once', async () => {
    const { shop, account } = await shopWithCustomerAccount();
    const wrong = expectStatus(await entry(shop, account.id, { kind: 'charge', amountPaise: 99900 }), 201).transaction;

    const reversal = expectStatus(
      await call('post', `/merchant/stores/${shop.store.id}/khata/${account.id}/entries/${wrong.id}/reverse`, shop.merchant, {
        reason: 'Typed the wrong amount',
      }),
      201,
    );
    expect(reversal.transaction).toMatchObject({ entryKind: 'reversal', type: 'credit', amountPaise: 99900, reversesTransactionId: wrong.id });
    expect(reversal.account.balancePaise).toBe(0);

    const twice = await call('post', `/merchant/stores/${shop.store.id}/khata/${account.id}/entries/${wrong.id}/reverse`, shop.merchant, {
      reason: 'Again',
    });
    expect(twice.status).toBe(409);
    const ofReversal = await call(
      'post',
      `/merchant/stores/${shop.store.id}/khata/${account.id}/entries/${reversal.transaction.id}/reverse`,
      shop.merchant,
      { reason: 'Undo the undo' },
    );
    expect(ofReversal.status).toBe(422);

    // Both entries remain: the history explains the zero balance.
    expect(await sql('select entry_kind from khata_transactions where account_id = $1 order by created_at', [account.id])).toEqual([
      { entry_kind: 'charge' },
      { entry_kind: 'reversal' },
    ]);
  });

  it('the database refuses to edit or delete an entry', async () => {
    const { shop, account } = await shopWithCustomerAccount();
    expectStatus(await entry(shop, account.id, { kind: 'charge', amountPaise: 1000 }), 201);
    await expect(sql('update khata_transactions set amount_paise = 1')).rejects.toThrow(/immutable/);
    await expect(sql('delete from khata_transactions')).rejects.toThrow(/permanent/);
  });

  it('an adjustment needs a reason and a direction', async () => {
    const { shop, account } = await shopWithCustomerAccount();
    expect((await entry(shop, account.id, { kind: 'adjustment', amountPaise: 100 })).status).toBe(422);
    const ok = expectStatus(
      await entry(shop, account.id, { kind: 'adjustment', amountPaise: 100, direction: 'credit', description: 'Rounding goodwill' }),
      201,
    );
    expect(ok.transaction).toMatchObject({ entryKind: 'adjustment', type: 'credit' });
  });

  it('works out what is overdue, and reminds the customer without touching the ledger', async () => {
    const { shop, customer, account } = await shopWithCustomerAccount();
    expectStatus(await entry(shop, account.id, { kind: 'charge', amountPaise: 20000, dueDate: '2020-01-31' }), 201);
    expectStatus(await entry(shop, account.id, { kind: 'charge', amountPaise: 15000, dueDate: '2099-12-31' }), 201);
    expectStatus(await entry(shop, account.id, { kind: 'payment', amountPaise: 5000 }), 201);

    const list = expectStatus(await call('get', `/merchant/stores/${shop.store.id}/khata?status=overdue`, shop.merchant), 200);
    expect(list.accounts).toHaveLength(1);
    // The payment settles the oldest charge first: 20000 − 5000 overdue.
    expect(list.accounts[0].ageing).toMatchObject({ outstandingPaise: 30000, overduePaise: 15000, earliestDueDate: '2020-01-31' });
    expect(list.summary).toMatchObject({ outstandingPaise: 30000, overduePaise: 15000 });

    const before = await sql('select count(*)::int as n from khata_transactions');
    const reminded = expectStatus(
      await call('post', `/merchant/stores/${shop.store.id}/khata/${account.id}/reminders`, shop.merchant, { note: 'Please clear by Friday' }),
      201,
    );
    expect(reminded.reminder.id).toBeTruthy();
    expect(await sql('select count(*)::int as n from khata_transactions')).toEqual(before);
    expect(
      (await sql(`select count(*)::int as n from notifications where customer_id = $1 and type = 'khata_reminder'`, [customer.id]))[0].n,
    ).toBe(1);

    expectStatus(await call('patch', `/merchant/stores/${shop.store.id}/khata/${account.id}`, shop.merchant, { remindersEnabled: false }), 200);
    expect((await call('post', `/merchant/stores/${shop.store.id}/khata/${account.id}/reminders`, shop.merchant, {})).status).toBe(422);
  });

  it('one account per customer per store, and only real customers can be found', async () => {
    const { shop, customer } = await shopWithCustomerAccount();
    const [{ email }] = await sql('select email from customers where id = $1', [customer.id]);
    expect((await call('post', `/merchant/stores/${shop.store.id}/khata`, shop.merchant, { email })).status).toBe(409);
    expect((await call('post', `/merchant/stores/${shop.store.id}/khata`, shop.merchant, { email: 'nobody@nowhere.test' })).status).toBe(422);
    // A customerId that never ordered here is not discoverable.
    expect((await call('post', `/merchant/stores/${shop.store.id}/khata`, shop.merchant, { customerId: customer.id })).status).toBe(404);
  });

  it("the store's khata settings round-trip through the merchant store view", async () => {
    const shop = await flow.openShop();
    const before = expectStatus(await call('get', `/merchant/stores/${shop.store.id}`, shop.merchant), 200);
    expect(before.store.khata).toEqual({ enabled: false, dueDays: 30, autoReminders: false });

    expectStatus(await call('put', `/merchant/stores/${shop.store.id}/khata-settings`, shop.merchant, { khataEnabled: true, khataDueDays: 15 }), 200);
    expectStatus(await call('put', `/merchant/stores/${shop.store.id}/khata-settings/auto-reminders`, shop.merchant, { enabled: true }), 200);
    const after = expectStatus(await call('get', `/merchant/stores/${shop.store.id}`, shop.merchant), 200);
    expect(after.store.khata).toEqual({ enabled: true, dueDays: 15, autoReminders: true });

    const other = await flow.openShop({ name: 'Other' });
    expect((await call('put', `/merchant/stores/${shop.store.id}/khata-settings/auto-reminders`, other.merchant, { enabled: false })).status).toBe(404);
  });

  it('another merchant cannot read or write this khata', async () => {
    const { shop, account } = await shopWithCustomerAccount();
    const other = await flow.openShop({ name: 'Other' });
    expect((await call('get', `/merchant/stores/${other.store.id}/khata/${account.id}`, other.merchant)).status).toBe(404);
    expect((await entry(other, account.id, { kind: 'charge', amountPaise: 1 })).status).toBe(404);
    expect((await call('get', `/merchant/stores/${shop.store.id}/khata/${account.id}`, other.merchant)).status).toBe(404);
  });
});

describe('paying on khata at checkout', () => {
  async function khataShop({ limit = 50000 } = {}) {
    const ctx = await shopWithCustomerAccount({ creditLimitPaise: limit });
    expectStatus(await call('put', `/merchant/stores/${ctx.shop.store.id}/khata-settings`, ctx.shop.merchant, { khataEnabled: true }), 200);
    const rice = await flow.addRice(ctx.shop, { taxPercent: 0 });
    return { ...ctx, rice };
  }

  it('charges the account in the same transaction as the order, within the credit limit', async () => {
    const { shop, customer, account, rice } = await khataShop();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 2);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id, paymentMethod: 'khata' }), 201);
    expect(order).toMatchObject({ paymentMethod: 'khata', paymentStatus: 'paid', status: 'placed' });

    const [txn] = await sql('select type, amount_paise, entry_kind, order_id, due_date from khata_transactions where account_id = $1', [account.id]);
    expect(txn).toMatchObject({ type: 'debit', amount_paise: 24000, entry_kind: 'charge', order_id: order.id });
    expect(txn.due_date).toBeTruthy();
  });

  it('refuses an order above the available credit, and leaves nothing behind', async () => {
    const { shop, customer, rice } = await khataShop({ limit: 20000 });
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 2);
    const response = await flow.placeOrder(customer, { storeId: shop.store.id, paymentMethod: 'khata' });
    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({ code: 'KHATA_LIMIT_EXCEEDED', details: { availablePaise: 20000 } });
    expect(await sql('select count(*)::int as n from orders')).toEqual([{ n: 0 }]);
    expect(await sql('select reserved_quantity from product_variants where id = $1', [rice.kg.id])).toEqual([{ reserved_quantity: 0 }]);
  });

  it('is refused at a store that does not offer khata', async () => {
    const shop = await flow.openShop();
    await flow.publish(shop);
    const rice = await flow.addRice(shop);
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const response = await flow.placeOrder(customer, { storeId: shop.store.id, paymentMethod: 'khata' });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
  });

  it('cancelling credits the amount back as a separate entry linked to the order and the refund', async () => {
    const { shop, customer, account, rice } = await khataShop();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id, paymentMethod: 'khata' }), 201);

    expectStatus(await call('post', `/merchant/stores/${shop.store.id}/orders/${order.id}/reject`, shop.merchant, { reason: 'Sold out' }), 200);

    const detail = expectStatus(await call('get', `/orders/${order.id}`, customer.auth), 200).order;
    expect(detail.paymentStatus).toBe('refunded');
    expect(detail.refund).toMatchObject({ status: 'refunded', method: 'khata_credit', amountPaise: 12000, isFinal: true });

    const entries = await sql(
      'select type, entry_kind, amount_paise, order_id, refund_id from khata_transactions where account_id = $1 order by created_at',
      [account.id],
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ type: 'debit', entry_kind: 'charge', order_id: order.id, refund_id: null });
    expect(entries[1]).toMatchObject({ type: 'credit', entry_kind: 'refund_credit', amount_paise: 12000, order_id: order.id });
    expect(entries[1].refund_id).toBe(detail.refund.id);
    expect(detail.refund.khataTransactionId).toBeTruthy();

    const mine = expectStatus(await call('get', `/khata/${account.id}`, customer.auth), 200);
    expect(mine.account.balancePaise).toBe(0);
    expect(mine.transactions[0]).toMatchObject({ entryKind: 'refund_credit', refundId: detail.refund.id, orderId: order.id });
  });
});

describe('khata ageing (pure)', () => {
  it('settles oldest charges first and counts only past-due remainders as overdue', () => {
    const result = khataAgeing(
      [
        { type: 'debit', amount_paise: 100, due_date: '2026-01-10', occurred_at: '2026-01-01' },
        { type: 'debit', amount_paise: 200, due_date: '2026-02-10', occurred_at: '2026-02-01' },
        { type: 'credit', amount_paise: 150, due_date: null, occurred_at: '2026-02-05' },
      ],
      '2026-03-01',
    );
    expect(result).toMatchObject({ outstandingPaise: 150, overduePaise: 150, earliestDueDate: '2026-02-10', advancePaise: 0 });
  });

  it('reports an advance when payments exceed charges', () => {
    const result = khataAgeing([{ type: 'credit', amount_paise: 500, occurred_at: '2026-01-01' }], '2026-01-02');
    expect(result).toMatchObject({ outstandingPaise: 0, overduePaise: 0, advancePaise: 500 });
  });
});
