import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin } = await import('../src/lib/supabase.js');
const { db, seedCustomer, resetDb, authError } = await import('./helpers/supabaseMock.js');

const OTHER_ID = '11112222-3333-4444-8555-666677778888';

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
});

function signIn(row) {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: row.id } }, error: null });
  return row;
}

describe('GET /api/v1/me (2.8)', () => {
  it('returns the signed-in customer', async () => {
    const row = signIn(seedCustomer());

    const res = await api().get(url('/me')).set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.data.customer).toEqual({
      id: row.id,
      email: row.email,
      fullName: 'Test Customer',
      phone: '+919876543210',
      avatarUrl: null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  });

  it('verifies the token against Supabase rather than trusting it', async () => {
    signIn(seedCustomer());
    await api().get(url('/me')).set('Authorization', 'Bearer valid-token');
    expect(supabaseAdmin.auth.getUser).toHaveBeenCalledWith('valid-token');
  });

  it('returns 401 without a token', async () => {
    const res = await api().get(url('/me'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('PATCH /api/v1/me (2.9)', () => {
  it('updates the editable fields and returns the new profile', async () => {
    const row = signIn(seedCustomer());

    const res = await api()
      .patch(url('/me'))
      .set('Authorization', 'Bearer valid-token')
      .send({ fullName: 'Aditya S', phone: '+919000000000', avatarUrl: 'https://cdn.cpse.local/a.png' });

    expect(res.status).toBe(200);
    expect(res.body.data.customer).toMatchObject({
      fullName: 'Aditya S',
      phone: '+919000000000',
      avatarUrl: 'https://cdn.cpse.local/a.png',
    });
    expect(db.customers.get(row.id).full_name).toBe('Aditya S');
  });

  it('leaves omitted fields alone', async () => {
    const row = signIn(seedCustomer());

    await api()
      .patch(url('/me'))
      .set('Authorization', 'Bearer valid-token')
      .send({ fullName: 'Only The Name' });

    const stored = db.customers.get(row.id);
    expect(stored.full_name).toBe('Only The Name');
    expect(stored.phone).toBe('+919876543210');
  });

  it('lets an optional field be cleared with null', async () => {
    const row = signIn(seedCustomer());

    const res = await api()
      .patch(url('/me'))
      .set('Authorization', 'Bearer valid-token')
      .send({ phone: null });

    expect(res.status).toBe(200);
    expect(res.body.data.customer.phone).toBeNull();
    expect(db.customers.get(row.id).phone).toBeNull();
  });

  it('rejects an attempt to change the email (immutable)', async () => {
    const row = signIn(seedCustomer());

    const res = await api()
      .patch(url('/me'))
      .set('Authorization', 'Bearer valid-token')
      .send({ email: 'attacker@evil.test' });

    expect(res.status).toBe(422);
    expect(db.customers.get(row.id).email).toBe('test.customer@cpse.local');
  });

  it('rejects an attempt to change the id (immutable)', async () => {
    const row = signIn(seedCustomer());

    const res = await api()
      .patch(url('/me'))
      .set('Authorization', 'Bearer valid-token')
      .send({ id: OTHER_ID, fullName: 'Nice Try' });

    expect(res.status).toBe(422);
    expect(db.customers.get(row.id).full_name).toBe('Test Customer');
  });

  it('cannot touch another customer, because the id comes from the token', async () => {
    const mine = signIn(seedCustomer());
    const theirs = seedCustomer({ id: OTHER_ID, email: 'other@cpse.local', full_name: 'Someone Else' });

    const res = await api()
      .patch(url('/me'))
      .set('Authorization', 'Bearer valid-token')
      .send({ fullName: 'Changed' });

    expect(res.status).toBe(200);
    expect(db.customers.get(mine.id).full_name).toBe('Changed');
    expect(db.customers.get(theirs.id).full_name).toBe('Someone Else');
  });

  it('requires at least one field', async () => {
    signIn(seedCustomer());

    const res = await api()
      .patch(url('/me'))
      .set('Authorization', 'Bearer valid-token')
      .send({});

    expect(res.status).toBe(422);
  });

  it.each([
    ['a malformed phone', { phone: 'ring me' }],
    ['an empty name', { fullName: '   ' }],
    ['a non-URL avatar', { avatarUrl: 'not-a-url' }],
  ])('rejects %s', async (_label, body) => {
    signIn(seedCustomer());
    const res = await api().patch(url('/me')).set('Authorization', 'Bearer valid-token').send(body);
    expect(res.status).toBe(422);
  });

  it('requires authentication', async () => {
    const res = await api().patch(url('/me')).send({ fullName: 'Anon' });
    expect(res.status).toBe(401);
  });

  it('reports a write failure as 500 without leaking the database error', async () => {
    signIn(seedCustomer());
    // Only the update fails; the profile load in requireAuth still succeeds,
    // so this really does exercise the update path.
    db.failNextUpdate = { message: 'deadlock detected', code: '40P01' };

    const res = await api()
      .patch(url('/me'))
      .set('Authorization', 'Bearer valid-token')
      .send({ fullName: 'Aditya' });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('deadlock');
  });

  it('treats a valid token with no profile row as unauthenticated', async () => {
    // The row is created by a database trigger, so its absence means the
    // account was deleted underneath us — not that the request is malformed.
    const row = seedCustomer();
    signIn(row);
    db.customers.clear();

    const res = await api()
      .patch(url('/me'))
      .set('Authorization', 'Bearer valid-token')
      .send({ fullName: 'Aditya' });

    expect(res.status).toBe(401);
  });
});
