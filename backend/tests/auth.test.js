import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin, supabaseAnon, createUserClient } = await import('../src/lib/supabase.js');
const {
  db,
  CUSTOMER_ID,
  seedCustomer,
  resetDb,
  sessionFixture,
  authError,
} = await import('./helpers/supabaseMock.js');

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  supabaseAdmin.auth.admin.signOut.mockResolvedValue({ error: null });
  supabaseAnon.auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
});

/** Signs the next verifyAccessToken call in as this customer. */
function signedIn(row = seedCustomer()) {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: row.id } }, error: null });
  return row;
}

describe('POST /api/v1/auth/register (2.1)', () => {
  it('creates the account and returns the profile the signup trigger made', async () => {
    const row = seedCustomer({ full_name: 'Aditya', phone: null });
    supabaseAnon.auth.signUp.mockResolvedValue({
      data: { user: { id: row.id }, session: sessionFixture() },
      error: null,
    });

    const res = await api()
      .post(url('/auth/register'))
      .send({ email: 'Test.Customer@CPSE.local', password: 'CpseTest!2026', fullName: 'Aditya' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.customer).toMatchObject({ id: row.id, fullName: 'Aditya' });
    expect(res.body.data.session.accessToken).toBe('access-token-abc');
    expect(res.body.data.emailConfirmationRequired).toBe(false);

    // The email is normalised before it reaches Supabase.
    expect(supabaseAnon.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test.customer@cpse.local' }),
    );
  });

  it('passes the name and phone through as user metadata for the trigger', async () => {
    const row = seedCustomer();
    supabaseAnon.auth.signUp.mockResolvedValue({
      data: { user: { id: row.id }, session: sessionFixture() },
      error: null,
    });

    await api()
      .post(url('/auth/register'))
      .send({ email: 'a@b.com', password: 'CpseTest!2026', fullName: 'Aditya', phone: '+919876543210' });

    expect(supabaseAnon.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { data: { full_name: 'Aditya', phone: '+919876543210' } },
      }),
    );
  });

  it('reports that confirmation is pending when Supabase returns no session', async () => {
    const row = seedCustomer();
    supabaseAnon.auth.signUp.mockResolvedValue({
      data: { user: { id: row.id }, session: null },
      error: null,
    });

    const res = await api()
      .post(url('/auth/register'))
      .send({ email: 'a@b.com', password: 'CpseTest!2026' });

    expect(res.status).toBe(201);
    expect(res.body.data.session).toBeNull();
    expect(res.body.data.emailConfirmationRequired).toBe(true);
  });

  it('returns 409 when the email is already registered', async () => {
    supabaseAnon.auth.signUp.mockResolvedValue({
      data: {},
      error: authError('User already registered', 422),
    });

    const res = await api()
      .post(url('/auth/register'))
      .send({ email: 'a@b.com', password: 'CpseTest!2026' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it.each([
    ['a bad email', { email: 'not-an-email', password: 'CpseTest!2026' }],
    ['a short password', { email: 'a@b.com', password: 'short' }],
    ['a missing password', { email: 'a@b.com' }],
    ['a malformed phone', { email: 'a@b.com', password: 'CpseTest!2026', phone: 'call me' }],
  ])('rejects %s with 422 and never calls Supabase', async (_label, body) => {
    const res = await api().post(url('/auth/register')).send(body);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.issues.length).toBeGreaterThan(0);
    expect(supabaseAnon.auth.signUp).not.toHaveBeenCalled();
  });

  it('refuses unexpected fields rather than silently dropping them', async () => {
    const res = await api()
      .post(url('/auth/register'))
      .send({ email: 'a@b.com', password: 'CpseTest!2026', role: 'admin' });

    expect(res.status).toBe(422);
    expect(supabaseAnon.auth.signUp).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/auth/login (2.2)', () => {
  it('returns the session and profile', async () => {
    const row = seedCustomer();
    supabaseAnon.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: row.id }, session: sessionFixture() },
      error: null,
    });

    const res = await api()
      .post(url('/auth/login'))
      .send({ email: 'test.customer@cpse.local', password: 'CpseTest!2026' });

    expect(res.status).toBe(200);
    expect(res.body.data.customer.id).toBe(row.id);
    expect(res.body.data.session).toEqual({
      accessToken: 'access-token-abc',
      refreshToken: 'refresh-token-xyz',
      tokenType: 'bearer',
      expiresIn: 3600,
      expiresAt: 1789000000,
    });
  });

  it('returns 401 for a wrong password', async () => {
    supabaseAnon.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: authError('Invalid login credentials', 400),
    });

    const res = await api()
      .post(url('/auth/login'))
      .send({ email: 'test.customer@cpse.local', password: 'WrongPassword1' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('answers identically for an unknown email, so login cannot enumerate accounts', async () => {
    supabaseAnon.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: authError('Invalid login credentials', 400),
    });
    const unknown = await api()
      .post(url('/auth/login'))
      .send({ email: 'nobody@cpse.local', password: 'CpseTest!2026' });

    supabaseAnon.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: authError('Invalid login credentials', 400),
    });
    const wrongPassword = await api()
      .post(url('/auth/login'))
      .send({ email: 'test.customer@cpse.local', password: 'CpseTest!2026' });

    expect(unknown.status).toBe(wrongPassword.status);
    expect(unknown.body.error).toEqual(wrongPassword.body.error);
  });

  it('never echoes the password back, even in an error', async () => {
    supabaseAnon.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: authError('Invalid login credentials', 400),
    });

    const res = await api()
      .post(url('/auth/login'))
      .send({ email: 'a@b.com', password: 'SuperSecret123' });

    expect(JSON.stringify(res.body)).not.toContain('SuperSecret123');
  });
});

describe('POST /api/v1/auth/refresh (2.3)', () => {
  it('rotates the session', async () => {
    supabaseAnon.auth.refreshSession.mockResolvedValue({
      data: { session: sessionFixture({ access_token: 'new-access', refresh_token: 'new-refresh' }) },
      error: null,
    });

    const res = await api().post(url('/auth/refresh')).send({ refreshToken: 'refresh-token-xyz' });

    expect(res.status).toBe(200);
    expect(res.body.data.session.accessToken).toBe('new-access');
    expect(res.body.data.session.refreshToken).toBe('new-refresh');
    expect(supabaseAnon.auth.refreshSession).toHaveBeenCalledWith({ refresh_token: 'refresh-token-xyz' });
  });

  it('returns 401 for a revoked or expired refresh token', async () => {
    supabaseAnon.auth.refreshSession.mockResolvedValue({
      data: {},
      error: authError('Invalid Refresh Token', 401),
    });

    const res = await api().post(url('/auth/refresh')).send({ refreshToken: 'stale' });
    expect(res.status).toBe(401);
  });

  it('requires a refresh token', async () => {
    const res = await api().post(url('/auth/refresh')).send({});
    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/auth/logout (2.4)', () => {
  it('revokes the session globally and returns 204', async () => {
    signedIn();

    const res = await api()
      .post(url('/auth/logout'))
      .set('Authorization', 'Bearer access-token-abc');

    expect(res.status).toBe(204);
    expect(supabaseAdmin.auth.admin.signOut).toHaveBeenCalledWith('access-token-abc', 'global');
  });

  it('requires authentication', async () => {
    const res = await api().post(url('/auth/logout'));
    expect(res.status).toBe(401);
    expect(supabaseAdmin.auth.admin.signOut).not.toHaveBeenCalled();
  });

  it('still succeeds when the token was already revoked', async () => {
    signedIn();
    supabaseAdmin.auth.admin.signOut.mockResolvedValue({ error: authError('Not found', 404) });

    const res = await api()
      .post(url('/auth/logout'))
      .set('Authorization', 'Bearer access-token-abc');

    expect(res.status).toBe(204);
  });
});

describe('POST /api/v1/auth/forgot-password (2.5)', () => {
  it('sends a reset email with the configured redirect', async () => {
    const res = await api().post(url('/auth/forgot-password')).send({ email: 'test.customer@cpse.local' });

    expect(res.status).toBe(200);
    expect(supabaseAnon.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'test.customer@cpse.local',
      { redirectTo: 'http://localhost:5173/reset-password' },
    );
  });

  it('gives the same answer for an unregistered email', async () => {
    const known = await api().post(url('/auth/forgot-password')).send({ email: 'test.customer@cpse.local' });

    supabaseAnon.auth.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: authError('User not found', 404),
    });
    const unknown = await api().post(url('/auth/forgot-password')).send({ email: 'nobody@cpse.local' });

    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
  });

  it('validates the email', async () => {
    const res = await api().post(url('/auth/forgot-password')).send({ email: 'nope' });
    expect(res.status).toBe(422);
    expect(supabaseAnon.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/auth/reset-password (2.5)', () => {
  it('sets the new password using the recovery token', async () => {
    const row = seedCustomer();
    const updateUser = vi.fn().mockResolvedValue({ data: { user: { id: row.id } }, error: null });
    createUserClient.mockReturnValue({ auth: { updateUser } });

    const res = await api()
      .post(url('/auth/reset-password'))
      .send({ accessToken: 'recovery-token', password: 'BrandNew!2026' });

    expect(res.status).toBe(200);
    expect(res.body.data.customer.id).toBe(row.id);
    expect(createUserClient).toHaveBeenCalledWith('recovery-token');
    expect(updateUser).toHaveBeenCalledWith({ password: 'BrandNew!2026' });
  });

  it('returns 401 when the recovery link has expired', async () => {
    createUserClient.mockReturnValue({
      auth: { updateUser: vi.fn().mockResolvedValue({ data: {}, error: authError('expired', 401) }) },
    });

    const res = await api()
      .post(url('/auth/reset-password'))
      .send({ accessToken: 'stale-token', password: 'BrandNew!2026' });

    expect(res.status).toBe(401);
  });

  it('enforces the password policy before contacting Supabase', async () => {
    const res = await api()
      .post(url('/auth/reset-password'))
      .send({ accessToken: 'recovery-token', password: 'short' });

    expect(res.status).toBe(422);
    expect(createUserClient).not.toHaveBeenCalled();
  });
});

describe('auth failure modes', () => {
  it('surfaces a profile lookup failure as 500 without leaking the cause', async () => {
    const row = seedCustomer();
    supabaseAnon.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: row.id }, session: sessionFixture() },
      error: null,
    });
    db.failNextQuery = { message: 'connection terminated unexpectedly', code: '57P01' };

    const res = await api()
      .post(url('/auth/login'))
      .send({ email: 'test.customer@cpse.local', password: 'CpseTest!2026' });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('57P01');
  });

  it('never returns a password hash or raw Supabase user object', async () => {
    const row = signedIn();
    supabaseAnon.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: row.id, encrypted_password: 'hash', role: 'authenticated' }, session: sessionFixture() },
      error: null,
    });

    const res = await api()
      .post(url('/auth/login'))
      .send({ email: 'test.customer@cpse.local', password: 'CpseTest!2026' });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('encrypted_password');
    expect(Object.keys(res.body.data.customer).sort()).toEqual(
      ['avatarUrl', 'createdAt', 'email', 'fullName', 'id', 'phone', 'updatedAt'],
    );
  });
});
