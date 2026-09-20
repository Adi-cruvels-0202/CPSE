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

    // The match furthest to the RIGHT wins, then the longer of any tie.
    //
    // Neither rule alone is enough. Longest-wins lets '/stores/sharma-kirana'
    // answer '/stores/sharma-kirana/products/abc', because it is a prefix of it.
    // First-match-wins lets '/stores/' answer '/stores/<id>/save'. Taking the
    // rightmost start picks the most specific tail — the endpoint actually being
    // called — in both cases.
    const pattern = Object.keys(routes)
      .map((candidate) => ({ candidate, at: href.lastIndexOf(candidate) }))
      .filter((entry) => entry.at !== -1)
      .sort((a, b) => b.at - a.at || b.candidate.length - a.candidate.length)[0]?.candidate;

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

/** Categories, as GET /stores/:slug/categories returns them. */
export const categoriesFixture = (overrides = []) => ({
  storeId: '11111111-1111-4111-8111-000000000001',
  categories:
    overrides.length > 0
      ? overrides
      : [
          {
            id: '21111111-1111-4111-8111-000000000001',
            storeId: '11111111-1111-4111-8111-000000000001',
            name: 'Staples',
            slug: 'staples',
            sortOrder: 1,
          },
          {
            id: '21111111-1111-4111-8111-000000000002',
            storeId: '11111111-1111-4111-8111-000000000001',
            name: 'Snacks & Namkeen',
            slug: 'snacks',
            sortOrder: 2,
          },
        ],
});

/** One grid row. `isPurchasable` is the single flag a card gates on. */
export const productFixture = (overrides = {}) => ({
  id: '31111111-1111-4111-8111-000000000001',
  storeId: '11111111-1111-4111-8111-000000000001',
  categoryId: '21111111-1111-4111-8111-000000000001',
  name: 'Basmati Rice',
  slug: 'basmati-rice',
  description: 'Aged long-grain basmati, loose.',
  pricePaise: 12900,
  mrpPaise: 15000,
  isAvailable: true,
  stock: 25,
  outOfStock: false,
  isPurchasable: true,
  imageUrl: 'https://images.cpse.local/products/basmati-1.jpg',
  ...overrides,
});

/** The sold-out case the seeded catalogue actually contains. */
export const soldOutProductFixture = (overrides = {}) =>
  productFixture({
    id: '31111111-1111-4111-8111-000000000004',
    name: 'Soan Papdi',
    slug: 'soan-papdi',
    isAvailable: false,
    stock: 0,
    outOfStock: true,
    isPurchasable: false,
    ...overrides,
  });

export const productListFixture = (products, meta) => ({
  data: {
    storeId: '11111111-1111-4111-8111-000000000001',
    products: products ?? [productFixture()],
  },
  meta: meta ?? { page: 1, limit: 12, total: 1, totalPages: 1, hasNextPage: false },
});

/** A variant. Its price is absolute, not a delta off the product (backend D15). */
export const variantFixture = (overrides = {}) => ({
  id: '41111111-1111-4111-8111-000000000001',
  productId: '31111111-1111-4111-8111-000000000001',
  name: '1 kg',
  pricePaise: 12900,
  stock: 40,
  isAvailable: true,
  outOfStock: false,
  isPurchasable: true,
  ...overrides,
});

/** Product detail, with its images and variants. */
export const productDetailFixture = (overrides = {}) => ({
  storeId: '11111111-1111-4111-8111-000000000001',
  product: {
    ...productFixture(),
    images: [
      {
        id: '61111111-1111-4111-8111-000000000001',
        url: 'https://images.cpse.local/products/basmati-1.jpg',
        altText: 'Basmati rice',
        sortOrder: 1,
      },
      {
        id: '61111111-1111-4111-8111-000000000002',
        url: 'https://images.cpse.local/products/basmati-2.jpg',
        altText: 'Close up of grains',
        sortOrder: 2,
      },
    ],
    variants: [],
    ...overrides,
  },
});
