import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin } = await import('../src/lib/supabase.js');
const { db, seedCustomer, resetDb, authError } = await import('./helpers/supabaseMock.js');
const { requireAuth, optionalAuth, bearerToken } = await import('../src/middleware/requireAuth.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

/**
 * The middlewares are tested on a bare app rather than through a real route, so
 * these cases stay true no matter which endpoints later phases hang off them.
 */
function appWith(middleware) {
  const app = express();
  app.use(express.json());
  app.get('/probe', middleware, (req, res) =>
    res.json({ customer: req.customer, accessToken: req.accessToken ?? null }),
  );
  app.use(errorHandler);
  return request(app);
}

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
});

function tokenVerifies(row) {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: row.id } }, error: null });
}

function tokenRejected() {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: null, error: authError('invalid JWT', 401) });
}

describe('bearerToken', () => {
  const req = (header) => ({ get: () => header });

  it('reads a well-formed header', () => {
    expect(bearerToken(req('Bearer abc.def.ghi'))).toBe('abc.def.ghi');
  });

  it('is case-insensitive about the scheme', () => {
    expect(bearerToken(req('bearer abc'))).toBe('abc');
  });

  it.each([
    ['no header', undefined],
    ['the wrong scheme', 'Basic abc'],
    ['a scheme with no token', 'Bearer'],
    ['an empty token', 'Bearer    '],
    ['a bare token', 'abc.def.ghi'],
  ])('returns null for %s', (_label, header) => {
    expect(bearerToken(req(header))).toBeNull();
  });
});

describe('requireAuth (2.6)', () => {
  it('loads the customer onto the request', async () => {
    const row = seedCustomer();
    tokenVerifies(row);

    const res = await appWith(requireAuth).get('/probe').set('Authorization', 'Bearer good-token');

    expect(res.status).toBe(200);
    expect(res.body.customer.id).toBe(row.id);
    // Kept for the operations that must act as the user, e.g. logout.
    expect(res.body.accessToken).toBe('good-token');
  });

  it('rejects a missing token with 401', async () => {
    const res = await appWith(requireAuth).get('/probe');
    expect(res.status).toBe(401);
    expect(supabaseAdmin.auth.getUser).not.toHaveBeenCalled();
  });

  it('rejects a malformed Authorization header with 401', async () => {
    const res = await appWith(requireAuth).get('/probe').set('Authorization', 'Token abc');
    expect(res.status).toBe(401);
    expect(supabaseAdmin.auth.getUser).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired token with 401', async () => {
    tokenRejected();
    const res = await appWith(requireAuth).get('/probe').set('Authorization', 'Bearer expired');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/session has expired/i);
  });

  it('rejects a valid token whose profile row is gone', async () => {
    tokenVerifies(seedCustomer());
    db.customers.clear();

    const res = await appWith(requireAuth).get('/probe').set('Authorization', 'Bearer good-token');
    expect(res.status).toBe(401);
  });

  it('never reveals why a token failed', async () => {
    tokenRejected();
    const invalid = await appWith(requireAuth).get('/probe').set('Authorization', 'Bearer expired');

    tokenVerifies(seedCustomer());
    db.customers.clear();
    const noProfile = await appWith(requireAuth).get('/probe').set('Authorization', 'Bearer good-token');

    expect(invalid.body.error).toEqual(noProfile.body.error);
  });

  it('surfaces a profile lookup failure as 500, not as a silent 401', async () => {
    tokenVerifies(seedCustomer());
    db.failNextQuery = { message: 'connection refused', code: '08006' };

    const res = await appWith(requireAuth).get('/probe').set('Authorization', 'Bearer good-token');

    // A database outage must not look like "your session expired", which would
    // send every signed-in customer to the login screen.
    expect(res.status).toBe(500);
  });
});

describe('optionalAuth (2.7)', () => {
  it('attaches the customer when a valid token is present', async () => {
    const row = seedCustomer();
    tokenVerifies(row);

    const res = await appWith(optionalAuth).get('/probe').set('Authorization', 'Bearer good-token');

    expect(res.status).toBe(200);
    expect(res.body.customer.id).toBe(row.id);
  });

  it('allows an anonymous request through with no customer', async () => {
    const res = await appWith(optionalAuth).get('/probe');

    expect(res.status).toBe(200);
    expect(res.body.customer).toBeNull();
    expect(supabaseAdmin.auth.getUser).not.toHaveBeenCalled();
  });

  it.each([
    ['an expired token', () => tokenRejected()],
    ['a valid token with no profile', () => {
      tokenVerifies(seedCustomer());
      db.customers.clear();
    }],
  ])('falls back to anonymous for %s rather than failing', async (_label, arrange) => {
    arrange();

    const res = await appWith(optionalAuth).get('/probe').set('Authorization', 'Bearer whatever');

    // A shared store link must open even with a stale token in the browser.
    expect(res.status).toBe(200);
    expect(res.body.customer).toBeNull();
  });

  it('ignores a malformed header without calling Supabase', async () => {
    const res = await appWith(optionalAuth).get('/probe').set('Authorization', 'Basic abc');

    expect(res.status).toBe(200);
    expect(res.body.customer).toBeNull();
    expect(supabaseAdmin.auth.getUser).not.toHaveBeenCalled();
  });
});
