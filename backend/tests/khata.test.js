import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin } = await import('../src/lib/supabase.js');
const {
  db,
  CUSTOMER_ID,
  STORE_ID,
  resetDb,
  seedCustomer,
  seedStore,
  seedKhataAccount,
  seedKhataTransaction,
} = await import('./helpers/supabaseMock.js');

const OTHER_CUSTOMER_ID = '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e99';
const OTHER_STORE_ID = '11111111-1111-4111-8111-000000000002';
const UNKNOWN_ID = '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0eff';

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  seedCustomer();
  seedCustomer({ id: OTHER_CUSTOMER_ID, email: 'other@cpse.local' });
  seedStore();
  seedStore({ id: OTHER_STORE_ID, slug: 'green-leaf', name: 'Green Leaf Bakery' });
});

function signIn(id = CUSTOMER_ID) {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  return { Authorization: 'Bearer token-abc' };
}

/**
 * An account with a ledger that nets to 29_40 paise owed: two credit purchases
 * and one repayment, matching the shape the seeder writes.
 */
function accountWithLedger(overrides = {}) {
  const account = seedKhataAccount(overrides);
  seedKhataTransaction({
    account_id: account.id,
    type: 'debit',
    amount_paise: 25000,
    description: 'Groceries on credit',
    occurred_at: '2026-08-10T10:00:00.000Z',
  });
  seedKhataTransaction({
    account_id: account.id,
    type: 'credit',
    amount_paise: 20000,
    description: 'Repayment',
    occurred_at: '2026-09-05T10:00:00.000Z',
  });
  seedKhataTransaction({
    account_id: account.id,
    type: 'debit',
    amount_paise: 2400,
    description: 'Milk for the week',
    occurred_at: '2026-09-15T10:00:00.000Z',
  });
  return account;
}

describe('GET /api/v1/khata (9.6)', () => {
  it('requires a signed-in customer', async () => {
    expect((await api().get(url('/khata'))).status).toBe(401);
  });

  it('lists the accounts this customer is authorised to see', async () => {
    const auth = signIn();
    const account = accountWithLedger();

    const res = await api().get(url('/khata')).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.accounts).toHaveLength(1);
    expect(res.body.data.accounts[0]).toMatchObject({
      id: account.id,
      storeId: STORE_ID,
      balancePaise: 7400,
      outstandingPaise: 7400,
      creditPaise: 0,
      isSettled: false,
    });
  });

  it('carries the store, so the screen can name who is owed', async () => {
    const auth = signIn();
    accountWithLedger();

    const [entry] = (await api().get(url('/khata')).set(auth)).body.data.accounts;

    expect(entry.store).toMatchObject({
      id: STORE_ID,
      slug: 'sharma-kirana',
      name: 'Sharma Kirana Store',
    });
  });

  it('totals what is outstanding across stores', async () => {
    const auth = signIn();
    accountWithLedger();
    const second = seedKhataAccount({ store_id: OTHER_STORE_ID });
    seedKhataTransaction({ account_id: second.id, type: 'debit', amount_paise: 5000 });

    const res = await api().get(url('/khata')).set(auth);

    expect(res.body.data.totalOutstandingPaise).toBe(12400);
  });

  it('never counts a credit balance as something owed', async () => {
    const auth = signIn();
    const account = seedKhataAccount();
    seedKhataTransaction({ account_id: account.id, type: 'credit', amount_paise: 5000 });

    const res = await api().get(url('/khata')).set(auth);

    expect(res.body.data.accounts[0]).toMatchObject({
      balancePaise: -5000,
      outstandingPaise: 0,
      creditPaise: 5000,
    });
    expect(res.body.data.totalOutstandingPaise).toBe(0);
  });

  it('is empty for a customer with no khata', async () => {
    const res = await api().get(url('/khata')).set(signIn());

    expect(res.status).toBe(200);
    expect(res.body.data.accounts).toEqual([]);
    expect(res.body.data.totalOutstandingPaise).toBe(0);
  });

  it('never lists another customer’s account (9.6)', async () => {
    accountWithLedger({ customer_id: OTHER_CUSTOMER_ID });

    const res = await api().get(url('/khata')).set(signIn());

    expect(res.body.data.accounts).toEqual([]);
  });
});

describe('GET /api/v1/khata/:accountId (9.7)', () => {
  it('requires a signed-in customer', async () => {
    const account = accountWithLedger();

    expect((await api().get(url(`/khata/${account.id}`))).status).toBe(401);
  });

  it('returns the opening balance, what is outstanding, and the entries', async () => {
    const auth = signIn();
    const account = accountWithLedger();

    const res = await api().get(url(`/khata/${account.id}`)).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.totals).toMatchObject({
      // Nothing before the account's own history, so it opens at zero.
      openingPaise: 0,
      debitPaise: 27400,
      creditPaise: 20000,
      outstandingPaise: 7400,
      balancePaise: 7400,
    });
    expect(res.body.data.transactions).toHaveLength(3);
  });

  it('lists the newest entry first and signs each amount', async () => {
    const auth = signIn();
    const account = accountWithLedger();

    const { transactions } = (await api().get(url(`/khata/${account.id}`)).set(auth)).body.data;

    expect(transactions.map((txn) => txn.description)).toEqual([
      'Milk for the week',
      'Repayment',
      'Groceries on credit',
    ]);
    expect(transactions[0]).toMatchObject({ type: 'debit', amountPaise: 2400, signedAmountPaise: 2400 });
    expect(transactions[1]).toMatchObject({ type: 'credit', amountPaise: 20000, signedAmountPaise: -20000 });
  });

  it('shows the balance the store acts on, not a re-added ledger', async () => {
    const auth = signIn();
    const account = accountWithLedger();
    // Simulate the two disagreeing. The trigger-maintained column wins, because
    // that is the number the merchant side reads.
    db.tables.get('khata_accounts').find((row) => row.id === account.id).balance_paise = 9999;

    const res = await api().get(url(`/khata/${account.id}`)).set(auth);

    expect(res.body.data.totals.balancePaise).toBe(9999);
    expect(res.body.data.account.balancePaise).toBe(9999);
  });

  it('paginates the ledger', async () => {
    const auth = signIn();
    const account = accountWithLedger();

    const res = await api().get(url(`/khata/${account.id}?page=1&limit=2`)).set(auth);

    expect(res.body.data.transactions).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 2, total: 3, hasNextPage: true });
  });

  it('404s for another customer’s account, never 403 (9.6)', async () => {
    const account = accountWithLedger({ customer_id: OTHER_CUSTOMER_ID });

    const res = await api().get(url(`/khata/${account.id}`)).set(signIn());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('404s for an account that does not exist', async () => {
    expect((await api().get(url(`/khata/${UNKNOWN_ID}`)).set(signIn())).status).toBe(404);
  });

  it('422s on an account id that is not a uuid', async () => {
    expect((await api().get(url('/khata/not-a-uuid')).set(signIn())).status).toBe(422);
  });

  it('rejects an unknown query parameter', async () => {
    const account = accountWithLedger();

    expect((await api().get(url(`/khata/${account.id}?all=true`)).set(signIn())).status).toBe(422);
  });
});

describe('GET /api/v1/khata/:accountId/statement (9.8)', () => {
  const statement = (auth, accountId, query = '') =>
    api().get(url(`/khata/${accountId}/statement${query}`)).set(auth);

  it('requires a signed-in customer', async () => {
    const account = accountWithLedger();

    expect((await api().get(url(`/khata/${account.id}/statement`))).status).toBe(401);
  });

  it('gives the whole history when no period is asked for', async () => {
    const auth = signIn();
    const account = accountWithLedger();

    const res = await statement(auth, account.id);

    expect(res.status).toBe(200);
    expect(res.body.data.period).toEqual({ from: null, to: null });
    expect(res.body.data.totals).toMatchObject({
      openingPaise: 0,
      debitPaise: 27400,
      creditPaise: 20000,
      closingPaise: 7400,
      transactionCount: 3,
    });
  });

  it('opens a period at the balance carried into it (9.8)', async () => {
    const auth = signIn();
    const account = accountWithLedger();

    // September only: August's 25000 debit is the opening balance.
    const res = await statement(auth, account.id, '?from=2026-09-01T00:00:00Z');

    expect(res.body.data.totals).toMatchObject({
      openingPaise: 25000,
      debitPaise: 2400,
      creditPaise: 20000,
      closingPaise: 7400,
      transactionCount: 2,
    });
    expect(res.body.data.transactions).toHaveLength(2);
  });

  it('bounds the period at both ends', async () => {
    const auth = signIn();
    const account = accountWithLedger();

    const res = await statement(
      auth,
      account.id,
      '?from=2026-09-01T00:00:00Z&to=2026-09-10T00:00:00Z',
    );

    expect(res.body.data.transactions.map((txn) => txn.description)).toEqual(['Repayment']);
    expect(res.body.data.totals).toMatchObject({
      openingPaise: 25000,
      debitPaise: 0,
      creditPaise: 20000,
      closingPaise: 5000,
      transactionCount: 1,
    });
  });

  it('is empty, but still correct, for a period with no entries', async () => {
    const auth = signIn();
    const account = accountWithLedger();

    const res = await statement(auth, account.id, '?from=2026-10-01T00:00:00Z');

    expect(res.body.data.transactions).toEqual([]);
    expect(res.body.data.totals).toMatchObject({
      openingPaise: 7400,
      debitPaise: 0,
      creditPaise: 0,
      closingPaise: 7400,
      transactionCount: 0,
    });
  });

  it('422s when the period ends before it starts', async () => {
    const auth = signIn();
    const account = accountWithLedger();

    const res = await statement(
      auth,
      account.id,
      '?from=2026-09-20T00:00:00Z&to=2026-09-01T00:00:00Z',
    );

    expect(res.status).toBe(422);
  });

  it('422s on a malformed date', async () => {
    const auth = signIn();
    const account = accountWithLedger();

    expect((await statement(auth, account.id, '?from=last-tuesday')).status).toBe(422);
  });

  it('404s for another customer’s account', async () => {
    const account = accountWithLedger({ customer_id: OTHER_CUSTOMER_ID });

    expect((await statement(signIn(), account.id)).status).toBe(404);
  });
});

describe('khata is strictly read-only for customers (9.9)', () => {
  it('has no endpoint to create an account', async () => {
    const res = await api()
      .post(url('/khata'))
      .set(signIn())
      .send({ storeId: STORE_ID, balancePaise: -100000 });

    expect(res.status).toBe(404);
    expect(db.tables.get('khata_accounts') ?? []).toHaveLength(0);
  });

  it('has no endpoint to write a transaction', async () => {
    const auth = signIn();
    const account = accountWithLedger();

    for (const path of [
      `/khata/${account.id}/transactions`,
      `/khata/${account.id}/pay`,
      `/khata/${account.id}/settle`,
    ]) {
      const res = await api().post(url(path)).set(auth).send({ amountPaise: 7400 });
      expect(res.status, path).toBe(404);
    }

    // The ledger is exactly as it was.
    expect(db.tables.get('khata_transactions')).toHaveLength(3);
  });

  it('refuses to amend an account', async () => {
    const auth = signIn();
    const account = accountWithLedger();

    const patch = await api()
      .patch(url(`/khata/${account.id}`))
      .set(auth)
      .send({ balancePaise: 0 });
    const put = await api().put(url(`/khata/${account.id}`)).set(auth).send({ balancePaise: 0 });

    expect(patch.status).toBe(404);
    expect(put.status).toBe(404);
    expect(db.tables.get('khata_accounts')[0].balance_paise).toBe(7400);
  });

  it('refuses to delete an account or an entry', async () => {
    const auth = signIn();
    const account = accountWithLedger();
    const [entry] = db.tables.get('khata_transactions');

    const account404 = await api().delete(url(`/khata/${account.id}`)).set(auth);
    const entry404 = await api()
      .delete(url(`/khata/${account.id}/transactions/${entry.id}`))
      .set(auth);

    expect(account404.status).toBe(404);
    expect(entry404.status).toBe(404);
    expect(db.tables.get('khata_accounts')).toHaveLength(1);
    expect(db.tables.get('khata_transactions')).toHaveLength(3);
  });

  it('exports no writer from the service module', async () => {
    const khataService = await import('../src/modules/khata/khata.service.js');

    const writerish = Object.keys(khataService).filter((name) =>
      /^(create|update|delete|insert|write|pay|settle|add|remove|apply)/i.test(name),
    );
    expect(writerish).toEqual([]);
  });

  it('mounts only GET verbs on the khata router', async () => {
    const { khataRouter } = await import('../src/modules/khata/khata.routes.js');

    const methods = khataRouter.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route.methods));

    expect(methods.length).toBeGreaterThan(0);
    expect([...new Set(methods)]).toEqual(['get']);
  });
});
