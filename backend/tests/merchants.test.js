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

/**
 * A shop account and a customer account are separate logins with separate
 * emails (MERGE_MAPPING D-2, revised): each sign-in refuses the other kind,
 * and the customer routes refuse a shop account.
 */
describe('separate shop and customer accounts (D-2, revised)', () => {
  const credentials = { email: 'test.customer@cpse.local', password: 'CpseTest!2026' };
  const customerLogin = () => api().post(url('/auth/login')).send(credentials);
  const shopLogin = () => api().post(url('/merchant/auth/login')).send(credentials);
  const signInAs = (user) =>
    supabaseAnon.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: CUSTOMER_ID, email: credentials.email, user_metadata: {}, ...user }, session: sessionFixture() },
      error: null,
    });

  beforeEach(() => {
    seedCustomer();
    signInAs();
    supabaseAdmin.auth.admin.signOut.mockResolvedValue({ error: null });
  });

  it('signs a customer in to the customer app', async () => {
    const { status, body } = await customerLogin();
    expect(status).toBe(200);
    expect(body.data.roles).toEqual(['customer']);
  });

  it('refuses a shop account at the customer sign-in, and ends that session only', async () => {
    seedMerchant();

    const res = await customerLogin();
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SHOP_ACCOUNT');
    expect(res.body.data).toBeUndefined();
    expect(supabaseAdmin.auth.admin.signOut).toHaveBeenCalledWith('access-token-abc', 'local');
  });

  it('signs a shop account in to the shop app', async () => {
    seedMerchant();

    const { status, body } = await shopLogin();

    expect(status).toBe(200);
    expect(body.data.merchant).toMatchObject({ id: CUSTOMER_ID, fullName: 'Test Merchant' });
    expect(body.data.session.accessToken).toBe('access-token-abc');
    expect(body.data.roles).toEqual(['merchant']);
  });

  it('refuses a customer account at the shop sign-in', async () => {
    const res = await shopLogin();

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CUSTOMER_ACCOUNT');
    expect(supabaseAdmin.auth.admin.signOut).toHaveBeenCalledWith('access-token-abc', 'local');
    expect(merchants()).toHaveLength(0);
  });

  it('finishes a shop sign-up whose merchant profile was never written', async () => {
    signInAs({ user_metadata: { account_type: 'merchant', full_name: 'Sharma Stores', phone: '+911234567890' } });

    const { status, body } = await shopLogin();

    expect(status).toBe(200);
    expect(body.data.merchant).toMatchObject({ id: CUSTOMER_ID, fullName: 'Sharma Stores', phone: '+911234567890' });
    expect(merchants()).toHaveLength(1);
  });

  it('answers a wrong password the same at both sign-ins', async () => {
    supabaseAnon.auth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: authError('Invalid login credentials') });

    for (const res of [await customerLogin(), await shopLogin()]) {
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Email or password is incorrect.');
    }
  });

  it('marks a shop sign-up as a shop account', async () => {
    supabaseAnon.auth.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    await api().post(url('/merchant/auth/register')).send({ email: 'owner@shop.in', password: 'CpseMerchant!2026', fullName: 'Owner' });

    expect(supabaseAnon.auth.signUp.mock.calls[0][0].options.data.account_type).toBe('merchant');
  });

  it.each([
    ['GET', '/me'],
    ['GET', '/cart'],
    ['GET', '/orders'],
    ['GET', '/saved-stores'],
  ])('refuses a shop account on %s %s (403 SHOP_ACCOUNT)', async (method, path) => {
    seedMerchant();

    const res = await api()[method.toLowerCase()](url(path)).set(signIn());

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SHOP_ACCOUNT');
  });

  it('shows a shop account the storefront as a visitor', async () => {
    seedMerchant();
    seedStore({ is_published: true });

    const res = await api().get(url(`/stores/sharma-kirana`)).set(signIn());

    expect(res.status).toBe(200);
    expect(res.body.data.store.isSaved ?? false).toBe(false);
  });
});

describe('GET /api/v1/merchant/me', () => {
  it('is 403 MERCHANT_REQUIRED for a customer account', async () => {
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
