import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';
import { collectRoutes, routeKey, fill, paramsOf, PUBLIC_ROUTES } from './helpers/routes.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin } = await import('../src/lib/supabase.js');
const { CUSTOMER_ID, STORE_ID, resetDb, seedCustomer, seedStore } =
  await import('./helpers/supabaseMock.js');
const { apiRouter } = await import('../src/routes.js');

const ROUTES = collectRoutes(apiRouter);

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  seedCustomer();
  seedStore();
});

function signIn(id = CUSTOMER_ID) {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  return { Authorization: 'Bearer token-abc' };
}

/** Issues a request at a route pattern, filling params with the given values. */
function call({ method, path }, values, auth) {
  const request = api()[method.toLowerCase()](url(fill(path, values)));
  if (auth) request.set(auth);
  return request.send(method === 'GET' || method === 'DELETE' ? undefined : {});
}

describe('the audit sees the whole API', () => {
  it('found every mounted route', () => {
    // A sanity floor: if this drops, the walker stopped seeing sub-routers and
    // every sweep below would pass by doing nothing.
    expect(ROUTES.length).toBeGreaterThanOrEqual(45);
  });

  it('has no duplicate method+path', () => {
    const keys = ROUTES.map(routeKey);
    expect(keys.length).toBe(new Set(keys).size);
  });
});

describe('10.1 — every route that touches owned data requires authentication', () => {
  const authenticated = ROUTES.filter((route) => !PUBLIC_ROUTES.has(routeKey(route)));

  it('classifies every route as public-by-design or authenticated', () => {
    // Fails when a new route is added without a deliberate decision about it:
    // either it is listed in PUBLIC_ROUTES with a reason, or it is expected to
    // answer 401 below.
    expect(authenticated.length).toBeGreaterThan(0);
    for (const route of ROUTES) {
      const key = routeKey(route);
      expect(
        PUBLIC_ROUTES.has(key) || authenticated.some((entry) => routeKey(entry) === key),
      ).toBe(true);
    }
  });

  it.each(authenticated.map((route) => [routeKey(route), route]))(
    '%s answers 401 without a token',
    async (_key, route) => {
      const res = await call(route, {
        slug: 'sharma-kirana',
        storeId: STORE_ID,
        default: '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e12',
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    },
  );

  it.each(authenticated.map((route) => [routeKey(route), route]))(
    '%s answers 401 for a junk token, not 500',
    async (_key, route) => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'invalid JWT', status: 401 },
      });

      const res = await call(
        route,
        { slug: 'sharma-kirana', storeId: STORE_ID, default: '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e12' },
        { Authorization: 'Bearer not-a-real-token' },
      );

      expect(res.status).toBe(401);
    },
  );

  it.each([...PUBLIC_ROUTES.keys()].map((key) => [key]))(
    '%s stays reachable with no token',
    async (key) => {
      const route = ROUTES.find((entry) => routeKey(entry) === key);
      expect(route, `${key} is listed as public but is not mounted`).toBeDefined();

      const res = await call(route, { slug: 'sharma-kirana', default: 'x' });

      // Whatever it answers, it must not be an authentication complaint.
      expect(res.status).not.toBe(401);
    },
  );
});

describe('10.2 — every identifier in a path is validated', () => {
  // :slug is the one parameter that is not a uuid; everything else is.
  const uuidRoutes = ROUTES.filter((route) =>
    paramsOf(route.path).some((param) => param !== 'slug'),
  );

  it('there are identifier-bearing routes to check', () => {
    expect(uuidRoutes.length).toBeGreaterThanOrEqual(15);
  });

  it.each(uuidRoutes.map((route) => [routeKey(route), route]))(
    '%s rejects a non-uuid identifier with 422',
    async (_key, route) => {
      const auth = signIn();

      const res = await call(route, { slug: 'sharma-kirana', default: 'definitely-not-a-uuid' }, auth);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.issues[0]).toMatchObject({ source: 'params' });
    },
  );

  it.each(uuidRoutes.map((route) => [routeKey(route), route]))(
    '%s rejects a SQL-ish identifier with 422, never a 500',
    async (_key, route) => {
      const auth = signIn();

      const res = await call(
        route,
        { slug: 'sharma-kirana', default: "1' or '1'='1" },
        auth,
      );

      expect(res.status).toBe(422);
    },
  );

  it('rejects a slug that is not slug-shaped', async () => {
    const res = await api().get(url('/stores/Not A Slug!'));

    expect(res.status).toBe(422);
  });

  it.each(
    ROUTES.filter((route) => ['POST', 'PATCH'].includes(route.method)).map((route) => [
      routeKey(route),
      route,
    ]),
  )('%s rejects an unknown body field (D20)', async (_key, route) => {
    const auth = signIn();

    const res = await api()[route.method.toLowerCase()](
      url(fill(route.path, { slug: 'sharma-kirana', storeId: STORE_ID, default: CUSTOMER_ID })),
    )
      .set(auth)
      .send({ definitelyNotAField: 'x' });

    // Either the schema rejects the unknown key (422), or the route takes no
    // body at all and fails for its own reason first — but never 201/200, which
    // would mean the field was silently dropped.
    expect([400, 401, 404, 409, 422]).toContain(res.status);
  });
});

describe('10.5 — one error contract everywhere', () => {
  const CODES = new Set([
    'BAD_REQUEST',
    'VALIDATION_FAILED',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'ROUTE_NOT_FOUND',
    'CONFLICT',
    'RATE_LIMITED',
    'INTERNAL_ERROR',
    'SERVICE_UNAVAILABLE',
    // Domain-specific 422s, each one deliberate.
    'TOTAL_CHANGED',
    'MINIMUM_ORDER_NOT_MET',
    'ITEM_UNAVAILABLE',
    'CART_EMPTY',
    'NOT_AN_ONLINE_ORDER',
    'STORE_CLOSED',
    'FULFILMENT_UNAVAILABLE',
    'ADDRESS_REQUIRED',
    'PRICE_CHANGED',
    'PAYMENT_FAILED',
    // Rejections that happen before any handler runs.
    'PAYLOAD_TOO_LARGE',
    'MALFORMED_JSON',
    'UNSUPPORTED_MEDIA_TYPE',
  ]);

  async function everyErrorResponse() {
    const responses = [];

    // One failing call per route: no token where a token is needed, a junk id
    // where an id is needed.
    for (const route of ROUTES) {
      responses.push(
        await call(route, { slug: 'unknown-store', default: 'not-a-uuid' }),
      );
    }
    return responses.filter((res) => res.status >= 400);
  }

  it('uses the same failure envelope on every route', async () => {
    const failures = await everyErrorResponse();

    expect(failures.length).toBeGreaterThan(20);
    for (const res of failures) {
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error.code).toBe('string');
      expect(typeof res.body.error.message).toBe('string');
      expect(res.body.error.message.length).toBeGreaterThan(0);
      expect(res.body.requestId).toBeTruthy();
      // The envelope carries exactly these keys — no stray internals.
      expect(Object.keys(res.body).sort()).toEqual(['error', 'requestId', 'success']);
      expect(Object.keys(res.body.error).every((key) =>
        ['code', 'message', 'details'].includes(key),
      )).toBe(true);
    }
  });

  it('only uses error codes from the documented set', async () => {
    const failures = await everyErrorResponse();
    const seen = new Set(failures.map((res) => res.body.error.code));

    for (const code of seen) expect(CODES.has(code), `undocumented code ${code}`).toBe(true);
  });

  it('echoes the X-Request-Id header on a failure as well as a success', async () => {
    const failure = await api().get(url('/orders')).set('X-Request-Id', 'trace-me-12345');
    const success = await api().get(url('/health')).set('X-Request-Id', 'trace-me-12345');

    expect(failure.headers['x-request-id']).toBe('trace-me-12345');
    expect(failure.body.requestId).toBe('trace-me-12345');
    expect(success.headers['x-request-id']).toBe('trace-me-12345');
  });

  it('replaces an implausible client request id instead of echoing it (10.4)', async () => {
    const res = await api().get(url('/health')).set('X-Request-Id', 'x'.repeat(5000));

    expect(res.headers['x-request-id']).not.toContain('xxxxxxxxxx');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers an unknown route with ROUTE_NOT_FOUND, not a stack trace', async () => {
    const res = await api().get(url('/nope/nowhere'));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(res.body.error.stack).toBeUndefined();
  });

  it('answers a wrong verb on a real path with a 404, not a 500', async () => {
    const res = await api().put(url('/orders')).set(signIn()).send({});

    expect(res.status).toBe(404);
  });
});

describe('10.7 — payload limits', () => {
  it('refuses a body larger than the configured cap', async () => {
    const auth = signIn();

    const res = await api()
      .post(url('/cart/items'))
      .set(auth)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ note: 'A'.repeat(64 * 1024) }));

    expect(res.status).toBe(413);
  });

  it('reports a malformed body as the caller’s problem, not a 500 (10.5)', async () => {
    const res = await api()
      .post(url('/cart/items'))
      .set(signIn())
      .set('Content-Type', 'application/json')
      .send('{"storeId": ');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_JSON');
  });

  it('names the limit when it refuses an oversized body', async () => {
    const res = await api()
      .post(url('/cart/items'))
      .set(signIn())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ note: 'A'.repeat(64 * 1024) }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('still accepts an ordinary body', async () => {
    const res = await api().post(url('/cart/items')).set(signIn()).send({
      storeId: STORE_ID,
      productId: '31111111-1111-4111-8111-000000000001',
      quantity: 1,
    });

    expect(res.status).not.toBe(413);
  });
});
