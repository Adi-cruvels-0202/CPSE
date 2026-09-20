import { describe, it, expect, vi } from 'vitest';
import { ApiError, api, request, requestData } from '../src/lib/api.js';
import { readSession, writeSession } from '../src/lib/tokens.js';
import {
  fail,
  mockFetch,
  noContent,
  notJson,
  ok,
  sessionFixture,
  validationFail,
} from './helpers/api.js';

describe('the envelope', () => {
  it('returns data and meta, not the wrapper', async () => {
    mockFetch([ok({ orders: [] }, { page: 1, total: 0 })]);

    const result = await request('/orders');

    expect(result).toEqual({ data: { orders: [] }, meta: { page: 1, total: 0 } });
  });

  it('gives just data through requestData', async () => {
    mockFetch([ok({ customer: { id: 'c1' } })]);

    expect(await requestData('/me')).toEqual({ customer: { id: 'c1' } });
  });

  it('handles a 204 with no body', async () => {
    mockFetch([noContent()]);

    expect(await api.post('/auth/logout')).toEqual({ data: null, meta: null });
  });

  it('survives a response that is not JSON', async () => {
    // A proxy returning an HTML error page, which has bitten every SPA once.
    mockFetch([notJson(502)]);

    await expect(request('/orders')).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
      code: 'UNKNOWN_ERROR',
    });
  });
});

describe('ApiError', () => {
  it('carries the code, message and request id', async () => {
    mockFetch([fail(404, 'NOT_FOUND', 'Order was not found.')]);

    const error = await request('/orders/x').catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Order was not found.');
    expect(error.requestId).toBe('req-test');
    expect(error.isNotFound).toBe(true);
  });

  it('flattens a 422 into one message per field', async () => {
    mockFetch([
      validationFail([
        { source: 'body', field: 'phone', message: 'Enter a valid phone number.' },
        { source: 'body', field: 'city', message: 'Required' },
        // A second issue on the same field: a form shows one error per input.
        { source: 'body', field: 'phone', message: 'Too short' },
      ]),
    ]);

    const error = await api.post('/addresses', {}).catch((caught) => caught);

    expect(error.isValidation).toBe(true);
    expect(error.fieldErrors).toEqual({
      phone: 'Enter a valid phone number.',
      city: 'Required',
    });
  });

  it('has empty fieldErrors when there are no issues', async () => {
    mockFetch([fail(409, 'CONFLICT', 'This order is already cancelled.')]);

    const error = await api.post('/orders/x/cancel', {}).catch((caught) => caught);

    expect(error.fieldErrors).toEqual({});
  });

  it('knows which failures are worth retrying', async () => {
    const transient = [0, 429, 500, 503];
    const permanent = [400, 401, 404, 409, 422];

    for (const status of transient) {
      expect(new ApiError({ status }).isTransient, String(status)).toBe(true);
    }
    for (const status of permanent) {
      expect(new ApiError({ status }).isTransient, String(status)).toBe(false);
    }
  });

  it('reports an unreachable server as a network error, not a 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    const error = await request('/health', { auth: 'none' }).catch((caught) => caught);

    expect(error.status).toBe(0);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.isTransient).toBe(true);
    expect(error.message).toMatch(/connection/i);
  });

  it('lets an aborted request through as an abort, not a network error', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw abortError;
    }));

    await expect(request('/orders')).rejects.toBe(abortError);
  });
});

describe('the request itself', () => {
  it('builds the URL from the configured base', async () => {
    const { calls } = mockFetch([ok({})]);

    await request('/orders');

    expect(calls[0].url).toBe('http://api.test/api/v1/orders');
  });

  it('adds query parameters, and drops the empty ones', async () => {
    const { calls } = mockFetch([ok({})]);

    await api.get('/orders', {
      query: { status: 'placed', storeId: undefined, page: 2, search: '', cursor: null },
    });

    const url = new URL(calls[0].url);
    expect(url.searchParams.get('status')).toBe('placed');
    expect(url.searchParams.get('page')).toBe('2');
    // `?storeId=undefined` would be rejected by the backend as an unknown value.
    expect(url.searchParams.has('storeId')).toBe(false);
    expect(url.searchParams.has('search')).toBe(false);
    expect(url.searchParams.has('cursor')).toBe(false);
  });

  it('sends a JSON body with a content type, and no body when there is none', async () => {
    const { calls } = mockFetch([ok({}), ok({})]);

    await api.post('/cart/items', { quantity: 2 });
    await api.post('/auth/logout');

    expect(calls[0].headers['content-type']).toBe('application/json');
    expect(calls[0].body).toEqual({ quantity: 2 });
    expect(calls[1].body).toBeUndefined();
    expect(calls[1].headers['content-type']).toBeUndefined();
  });

  it('passes an Idempotency-Key when one is given', async () => {
    const { calls } = mockFetch([ok({})]);

    await api.post('/orders', { storeId: 's1' }, { idempotencyKey: 'key-abc' });

    expect(calls[0].headers['idempotency-key']).toBe('key-abc');
  });
});

describe('the bearer token', () => {
  it('attaches it when there is a session', async () => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([ok({})]);

    await request('/orders');

    expect(calls[0].headers.authorization).toBe('Bearer access-1');
  });

  it('omits it when there is none', async () => {
    const { calls } = mockFetch([ok({})]);

    await request('/orders');

    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it('never sends it on an auth: none call, even with a session stored', async () => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([ok({})]);

    // Logging in as someone else while signed in must not carry the old token.
    await api.post('/auth/login', { email: 'a@b.c', password: 'x' }, { auth: 'none' });

    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it('attaches it on an auth: optional call so a store page personalises', async () => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([ok({})]);

    await api.get('/stores/sharma-kirana', { auth: 'optional' });

    expect(calls[0].headers.authorization).toBe('Bearer access-1');
  });
});

describe('refresh and replay', () => {
  it('refreshes once on a 401 and replays the request', async () => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([
      fail(401, 'UNAUTHORIZED', 'Your session has expired. Sign in again.'),
      ok({ session: { accessToken: 'access-2', refreshToken: 'refresh-2' } }),
      ok({ orders: ['replayed'] }),
    ]);

    const { data } = await request('/orders');

    expect(data).toEqual({ orders: ['replayed'] });
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/api/v1/orders',
      '/api/v1/auth/refresh',
      '/api/v1/orders',
    ]);
    // The replay carries the NEW token, not the expired one.
    expect(calls[2].headers.authorization).toBe('Bearer access-2');
    expect(readSession()?.accessToken).toBe('access-2');
  });

  it('sends the stored refresh token to the refresh endpoint', async () => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([
      fail(401, 'UNAUTHORIZED'),
      ok({ session: { accessToken: 'access-2', refreshToken: 'refresh-2' } }),
      ok({}),
    ]);

    await request('/me');

    expect(calls[1].body).toEqual({ refreshToken: 'refresh-1' });
  });

  it('signs the customer out when the refresh is rejected', async () => {
    writeSession(sessionFixture());
    mockFetch([
      fail(401, 'UNAUTHORIZED'),
      fail(401, 'UNAUTHORIZED', 'That refresh token is spent.'),
    ]);

    const error = await request('/orders').catch((caught) => caught);

    // The original 401 surfaces, and the dead session is gone.
    expect(error.status).toBe(401);
    expect(readSession()).toBeNull();
  });

  it('does NOT sign the customer out when the refresh call fails on the network', async () => {
    writeSession(sessionFixture());
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1;
      if (call === 1) return fail(401, 'UNAUTHORIZED');
      throw new TypeError('Failed to fetch');
    }));

    await expect(request('/orders')).rejects.toMatchObject({ status: 401 });
    // The token may still be perfectly good once the tunnel comes back.
    expect(readSession()?.refreshToken).toBe('refresh-1');
  });

  it('refreshes only once when several requests fail together', async () => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([
      fail(401, 'UNAUTHORIZED'),
      fail(401, 'UNAUTHORIZED'),
      fail(401, 'UNAUTHORIZED'),
      ok({ session: { accessToken: 'access-2', refreshToken: 'refresh-2' } }),
      ok({ a: 1 }),
      ok({ b: 2 }),
      ok({ c: 3 }),
    ]);

    await Promise.all([request('/orders'), request('/me'), request('/addresses')]);

    const refreshes = calls.filter((call) => call.url.includes('/auth/refresh'));
    // Three parallel refreshes would rotate the token three times, and the two
    // losers would present an already-spent refresh token — signing the
    // customer out for having a fast connection.
    expect(refreshes).toHaveLength(1);
  });

  it('does not refresh a 401 that carried no token', async () => {
    const { calls } = mockFetch([fail(401, 'UNAUTHORIZED', 'Sign in to continue.')]);

    await expect(request('/orders')).rejects.toMatchObject({ status: 401 });

    // Nothing to refresh with; "sign in first" is the correct answer.
    expect(calls).toHaveLength(1);
  });

  it('does not refresh on an auth: optional call', async () => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([fail(401, 'UNAUTHORIZED')]);

    await expect(api.get('/stores/x', { auth: 'optional' })).rejects.toMatchObject({
      status: 401,
    });

    // A public page works signed out; it must not drag the customer through a
    // token rotation to render a store.
    expect(calls).toHaveLength(1);
  });

  it('does not refresh a 403 or a 500', async () => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([fail(500, 'INTERNAL_ERROR')]);

    await expect(request('/orders')).rejects.toMatchObject({ status: 500 });

    expect(calls).toHaveLength(1);
  });
});
