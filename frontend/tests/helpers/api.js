import { vi } from 'vitest';

/**
 * A stand-in for fetch that answers with the backend's real envelopes.
 *
 * Queued rather than fixed: half of what the API client does is decide what to
 * do with the *second* response — the replay after a refresh — and a mock that
 * returns one thing forever cannot express that.
 */
export function mockFetch(responses) {
  const queue = [...responses];
  const calls = [];

  const fetchMock = vi.fn(async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      body: options.body ? JSON.parse(options.body) : undefined,
    });

    const next = queue.shift();
    if (!next) throw new Error(`Unexpected request to ${url} — the queue is empty.`);
    if (typeof next === 'function') return next({ url: String(url), options });
    return next;
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

/** `{ success: true, data, meta }`, the way every endpoint answers. */
export const ok = (data, meta) => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'x-request-id': 'req-test' }),
  json: async () => ({ success: true, data, ...(meta ? { meta } : {}) }),
});

export const created = (data) => ({ ...ok(data), status: 201 });

export const noContent = () => ({
  ok: true,
  status: 204,
  headers: new Headers(),
  json: async () => {
    throw new Error('204 has no body');
  },
});

/** `{ success: false, error: { code, message, details } }`. */
export const fail = (status, code, message = 'Something went wrong.', details) => ({
  ok: false,
  status,
  headers: new Headers({ 'x-request-id': 'req-test' }),
  json: async () => ({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
    requestId: 'req-test',
  }),
});

/** A 422 shaped the way the backend's validate middleware shapes one. */
export const validationFail = (issues) =>
  fail(422, 'VALIDATION_FAILED', 'The request did not pass validation.', { issues });

/** A response body that is not JSON at all — a proxy's HTML error page. */
export const notJson = (status = 502) => ({
  ok: status < 400,
  status,
  headers: new Headers(),
  json: async () => {
    throw new SyntaxError('Unexpected token < in JSON');
  },
});

export const sessionFixture = (overrides = {}) => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1789000000,
  ...overrides,
});

export const customerFixture = (overrides = {}) => ({
  id: '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e12',
  email: 'test.customer@cpse.local',
  fullName: 'Test Customer',
  phone: '+919876543210',
  avatarUrl: null,
  ...overrides,
});
