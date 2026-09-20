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

/**
 * Answers by URL rather than by queue position.
 *
 * A queue makes a test depend on which effect fires first — and when a screen
 * and the auth provider both fetch on mount, that order is not guaranteed. This
 * matches the first pattern that the request path contains, so a test says what
 * each endpoint returns and stops caring about sequence.
 *
 *   mockRoutes({ '/me': ok({ customer }), '/stores/': ok({ store }) })
 *
 * A pattern may map to an array, which is then consumed in order for repeat
 * calls to that same endpoint — which is how the refresh-and-replay cases are
 * expressed.
 */
export function mockRoutes(routes) {
  const remaining = new Map(
    Object.entries(routes).map(([pattern, value]) => [
      pattern,
      Array.isArray(value) ? [...value] : null,
    ]),
  );
  const calls = [];

  const fetchMock = vi.fn(async (url, options = {}) => {
    const href = String(url);
    calls.push({
      url: href,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      body: options.body ? JSON.parse(options.body) : undefined,
    });

    // Longest match wins: '/stores/' would otherwise swallow
    // '/stores/<id>/save', and the save would be answered by the store route.
    const pattern = Object.keys(routes)
      .filter((candidate) => href.includes(candidate))
      .sort((a, b) => b.length - a.length)[0];

    if (!pattern) throw new Error(`No mock route matches ${href}`);

    const queue = remaining.get(pattern);
    const response = queue ? (queue.shift() ?? routes[pattern].at(-1)) : routes[pattern];

    if (typeof response === 'function') return response({ url: href, options });
    return response;
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

/** The store payload, shaped exactly as GET /stores/:slug returns it. */
export const storeFixture = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-000000000001',
  slug: 'sharma-kirana',
  name: 'Sharma Kirana Store',
  description: 'Neighbourhood grocery — staples, snacks and daily essentials.',
  logoUrl: 'https://images.cpse.local/stores/sharma-kirana/logo.png',
  coverImageUrl: 'https://images.cpse.local/stores/sharma-kirana/cover.jpg',
  contact: { phone: '+919812345601', email: 'hello@sharmakirana.local' },
  location: {
    addressLine1: '14 Model Town Road',
    addressLine2: 'Near Gurudwara',
    city: 'Ludhiana',
    state: 'Punjab',
    postalCode: '141002',
    country: 'IN',
    latitude: 30.900965,
    longitude: 75.857276,
  },
  hours: {
    timezone: 'Asia/Kolkata',
    openingHours: {
      mon: [{ open: '08:00', close: '21:00' }],
      tue: [{ open: '08:00', close: '21:00' }],
      wed: [{ open: '08:00', close: '21:00' }],
      thu: [{ open: '08:00', close: '21:00' }],
      fri: [{ open: '08:00', close: '21:00' }],
      sat: [{ open: '08:00', close: '22:00' }],
      sun: [{ open: '09:00', close: '13:00' }],
    },
    localTime: '10:30',
    localDay: 'mon',
    isOpen: true,
    closesAt: '21:00',
    opensAt: null,
    opensOn: null,
  },
  fulfilment: {
    pickupEnabled: true,
    deliveryEnabled: true,
    minOrderPaise: 19900,
    deliveryFeePaise: 2900,
  },
  payment: { online: true, cashOnDelivery: true },
  isSaved: null,
  ...overrides,
});

/** A store that is shut, with the server's "opens on Monday" answer. */
export const closedStoreFixture = (overrides = {}) =>
  storeFixture({
    hours: {
      ...storeFixture().hours,
      localTime: '14:47',
      localDay: 'sun',
      isOpen: false,
      closesAt: null,
      opensAt: '08:00',
      opensOn: 'mon',
    },
    ...overrides,
  });
