import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin, supabaseAnon } = await import('../src/lib/supabase.js');
const {
  db,
  CUSTOMER_ID,
  STORE_ID,
  resetDb,
  seedCustomer,
  seedMerchant,
  seedStore,
  sessionFixture,
  authError,
} = await import('./helpers/supabaseMock.js');
const { requireStoreOwner } = await import('../src/middleware/requireMerchant.js');

/**
 * The merchant account — MERCHANT_API.md, Merchant account; D-2.
 */

const OTHER_MERCHANT_ID = '81111111-1111-4111-8111-000000000099';
const NEW_USER_ID = '81111111-1111-4111-8111-000000000042';

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
});

function signIn(id = CUSTOMER_ID) {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  return { Authorization: 'Bearer token-abc' };
}

const merchants = () => db.tables.get('merchants') ?? [];

const register = (body) =>
  api()
    .post(url('/merchant/auth/register'))
    .send({ email: 'Owner@Shop.in', password: 'ShopOwner!2026', fullName: 'Ravi Sharma', ...body });

describe('POST /api/v1/merchant/auth/register', () => {
  it('creates the login and the merchant profile together', async () => {
    seedCustomer({ id: NEW_USER_ID, email: 'owner@shop.in' });
    supabaseAnon.auth.signUp.mockResolvedValue({
      data: { user: { id: NEW_USER_ID, email: 'owner@shop.in', identities: [{}] }, session: sessionFixture() },
      error: null,
    });

    const res = await register({ phone: '+919812345678' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      merchant: { id: NEW_USER_ID, email: 'owner@shop.in', fullName: 'Ravi Sharma', phone: '+919812345678' },
      session: { accessToken: 'access-token-abc' },
      emailConfirmationRequired: false,
    });
    expect(merchants()).toHaveLength(1);
    expect(supabaseAnon.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({ email: 'owner@shop.in' }));
  });

  it('requires a name — a shop needs someone to call', async () => {
    const res = await register({ fullName: undefined });

    expect(res.status).toBe(422);
    expect(supabaseAnon.auth.signUp).not.toHaveBeenCalled();
  });

  it('says a taken email is taken, in the customer register’s words', async () => {
    supabaseAnon.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: authError('User already registered', 422),
    });

    const res = await register();

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('An account with that email already exists.');
  });

  it('still creates the profile when email confirmation is pending', async () => {
    supabaseAnon.auth.signUp.mockResolvedValue({
      data: { user: { id: NEW_USER_ID, email: 'owner@shop.in', identities: [{}] }, session: null },
      error: null,
    });

    const res = await register();

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ session: null, emailConfirmationRequired: true });
    expect(merchants()).toHaveLength(1);
  });

  it('writes nothing for the stand-in user Supabase returns for an existing address', async () => {
    // Confirmation on + an address that already exists: no error, a user with
    // no identities. Answering differently would reveal the account exists.
    supabaseAnon.auth.signUp.mockResolvedValue({
      data: { user: { id: NEW_USER_ID, email: 'owner@shop.in', identities: [] }, session: null },
      error: null,
    });

    const res = await register();

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ merchant: null, session: null, emailConfirmationRequired: true });
    expect(merchants()).toHaveLength(0);
  });
});

describe('POST /api/v1/auth/login — roles', () => {
  const login = () =>
    api().post(url('/auth/login')).send({ email: 'test.customer@cpse.local', password: 'CpseTest!2026' });

  beforeEach(() => {
    seedCustomer();
    supabaseAnon.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: CUSTOMER_ID }, session: sessionFixture() },
      error: null,
    });
  });

  it('is just a customer without a merchant profile', async () => {
    const { body } = await login();
    expect(body.data.roles).toEqual(['customer']);
  });

  it('is both with one', async () => {
    seedMerchant();
    const { body } = await login();
    expect(body.data.roles).toEqual(['customer', 'merchant']);
  });
});

describe('POST /api/v1/merchant/onboard', () => {
  beforeEach(() => {
    seedCustomer({ full_name: 'Test Customer', phone: '+919876543210' });
  });

  it('turns a signed-in customer into a merchant, taking their profile', async () => {
    const res = await api().post(url('/merchant/onboard')).set(signIn()).send({});

    expect(res.status).toBe(201);
    expect(res.body.data.merchant).toMatchObject({
      id: CUSTOMER_ID,
      email: 'test.customer@cpse.local',
      fullName: 'Test Customer',
      phone: '+919876543210',
    });
  });

  it('uses the name and phone sent, when sent', async () => {
    const res = await api()
      .post(url('/merchant/onboard'))
      .set(signIn())
      .send({ fullName: 'Sharma Stores', phone: '+911234567890' });

    expect(res.body.data.merchant).toMatchObject({ fullName: 'Sharma Stores', phone: '+911234567890' });
  });

  it('is idempotent: a second call answers 200 with the same merchant', async () => {
    const auth = signIn();
    await api().post(url('/merchant/onboard')).set(auth).send({});

    const res = await api().post(url('/merchant/onboard')).set(auth).send({ fullName: 'Ignored' });

    expect(res.status).toBe(200);
    expect(res.body.data.merchant.fullName).toBe('Test Customer');
    expect(merchants()).toHaveLength(1);
  });

  it('survives two onboard calls racing for the same account', async () => {
    const { onboardMerchant } = await import('../src/modules/merchants/merchant.service.js');
    // This call looks first and finds no merchant…
    const pending = onboardMerchant({ id: CUSTOMER_ID, email: 'test.customer@cpse.local' }, {});
    // …then the other call's row lands, so this call's insert hits the primary key.
    seedMerchant({ full_name: 'Won the race' });
    db.uniqueViolationOnInsert = { code: '23505', message: 'duplicate key value violates unique constraint "merchants_pkey"' };

    const { merchant, created } = await pending;
    expect(created).toBe(false);
    expect(merchant.fullName).toBe('Won the race');
  });
});

describe('GET /api/v1/merchant/me', () => {
  it('is 403 MERCHANT_REQUIRED for a customer, so the app can offer onboarding', async () => {
    seedCustomer();

    const res = await api().get(url('/merchant/me')).set(signIn());

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MERCHANT_REQUIRED');
  });

  it('returns the profile and only this merchant’s stores, newest first', async () => {
    seedCustomer();
    seedMerchant();
    seedStore({ id: STORE_ID, name: 'Older', slug: 'older', owner_id: CUSTOMER_ID, is_published: true, created_at: '2026-10-01T09:00:00Z' });
    seedStore({ id: '41111111-1111-4111-8111-0000000000a2', name: 'Newer', slug: 'newer', owner_id: CUSTOMER_ID, is_published: false, created_at: '2026-10-02T09:00:00Z' });
    seedStore({ id: '41111111-1111-4111-8111-0000000000a3', name: 'Not mine', slug: 'not-mine', owner_id: OTHER_MERCHANT_ID });

    const { status, body } = await api().get(url('/merchant/me')).set(signIn());

    expect(status).toBe(200);
    expect(body.data.merchant).toMatchObject({ id: CUSTOMER_ID, fullName: 'Test Merchant' });
    expect(body.data.stores).toEqual([
      { id: '41111111-1111-4111-8111-0000000000a2', name: 'Newer', slug: 'newer', isPublished: false, logoUrl: 'https://images.cpse.local/logo.png' },
      { id: STORE_ID, name: 'Older', slug: 'older', isPublished: true, logoUrl: 'https://images.cpse.local/logo.png' },
    ]);
  });
});

describe('PATCH /api/v1/merchant/me', () => {
  beforeEach(() => {
    seedCustomer();
  });

  it('updates the merchant profile, and phone: null clears it', async () => {
    seedMerchant();

    const res = await api().patch(url('/merchant/me')).set(signIn()).send({ fullName: 'Ravi', phone: null });

    expect(res.status).toBe(200);
    expect(res.body.data.merchant).toMatchObject({ fullName: 'Ravi', phone: null });
  });

  it('refuses to change the email rather than ignoring it', async () => {
    seedMerchant();

    const res = await api().patch(url('/merchant/me')).set(signIn()).send({ email: 'new@shop.in' });

    expect(res.status).toBe(422);
  });

  it('is 403 for a customer who is not a merchant', async () => {
    const res = await api().patch(url('/merchant/me')).set(signIn()).send({ fullName: 'Ravi' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MERCHANT_REQUIRED');
  });
});

describe('requireStoreOwner', () => {
  async function run(storeId, merchantId = CUSTOMER_ID) {
    const req = { params: { storeId }, merchant: { id: merchantId } };
    const next = vi.fn();
    await requireStoreOwner(req, {}, next);
    return { req, error: next.mock.calls[0][0] };
  }

  it('loads the merchant’s own store onto the request, published or not', async () => {
    seedStore({ owner_id: CUSTOMER_ID, is_published: false });

    const { req, error } = await run(STORE_ID);

    expect(error).toBeUndefined();
    expect(req.store).toMatchObject({ id: STORE_ID, is_published: false });
  });

  it('is the same 404 for another merchant’s store as for none at all', async () => {
    seedStore({ owner_id: OTHER_MERCHANT_ID });

    const theirs = await run(STORE_ID);
    const missing = await run('41111111-1111-4111-8111-0000000000ff');

    expect(theirs.error).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(missing.error).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', message: theirs.error.message });
  });

  it('does not hand an unowned seed store to anyone', async () => {
    seedStore({ owner_id: null });

    const { error } = await run(STORE_ID);

    expect(error).toMatchObject({ statusCode: 404 });
  });
});
