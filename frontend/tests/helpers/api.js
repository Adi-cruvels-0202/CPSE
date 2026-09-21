import { vi } from 'vitest';

/**
 * A stand-in for fetch that answers with the backend's real envelopes.
 *
 * Queued rather than fixed: half of what the API client does is decide what to
 * do with the *second* response — the replay after a refresh — and a mock that
 * returns one thing forever cannot express that.
 */
/**
 * Queued responses, in order.
 *
 * Kept for the auth-screen tests, whose point *is* a sequence — login, then the
 * profile, then a rotated session. Everything else uses `mockRoutes`, which does
 * not care which effect fires first.
 *
 * `ignore` lets a test exempt endpoints the app polls in the background — the
 * unread-count badge fires from the shell on every signed-in screen, and it would
 * otherwise eat a queued entry meant for something else.
 */
export function mockFetch(responses, { ignore = [], ignoreWith = () => ok({ unreadCount: 0 }) } = {}) {
  const queue = [...responses];
  const calls = [];

  const fetchMock = vi.fn(async (url, options = {}) => {
    const href = String(url);
    calls.push({
      url: href,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      body: options.body ? JSON.parse(options.body) : undefined,
    });

    // Background polling is answered without touching the queue.
    if (ignore.some((pattern) => href.includes(pattern))) return ignoreWith();

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

    // Matching, in three rules, each of which exists because of a bug:
    //
    //   1. against the PATHNAME only, so a value in a query string cannot be
    //      mistaken for an endpoint;
    //   2. on path-segment BOUNDARIES — '/me' must not match inside
    //      '/payments/methods', which is how the customer payload came back for a
    //      request for the payment methods;
    //   3. RIGHTMOST match wins, then the longer of a tie. Longest alone lets
    //      '/stores/sharma-kirana' answer '.../products/abc' because it is a
    //      prefix of it; leftmost lets '/stores/' answer '/stores/<id>/save'.
    const { pathname } = new URL(href);

    const pattern = Object.keys(routes)
      .map((candidate) => {
        const at = pathname.lastIndexOf(candidate);
        if (at === -1) return null;

        // A key ending in '/' is already a boundary; otherwise the next character
        // must end the segment.
        const after = pathname[at + candidate.length];
        const bounded = candidate.endsWith('/') || after === undefined || after === '/';
        return bounded ? { candidate, at } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.at - a.at || b.candidate.length - a.candidate.length)[0]?.candidate;

    if (!pattern) throw new Error(`No mock route matches ${pathname}`);

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

/** A cart line, as GET /cart returns one. */
export const cartLineFixture = (overrides = {}) => ({
  id: 'line-1',
  productId: '31111111-1111-4111-8111-000000000001',
  variantId: null,
  name: 'Basmati Rice',
  variantName: null,
  imageUrl: 'https://images.cpse.local/products/basmati-1.jpg',
  unitPricePaise: 12900,
  mrpPaise: 15000,
  quantity: 2,
  lineTotalPaise: 25800,
  stock: 25,
  isPurchasable: true,
  issues: [],
  ...overrides,
});

/**
 * The cart. Totals come from the server — the screen never adds anything up —
 * so a fixture has to state them explicitly, as the real payload does.
 */
export const cartFixture = (overrides = {}) => {
  const lines = overrides.lines ?? [cartLineFixture()];
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);

  return {
    storeId: '11111111-1111-4111-8111-000000000001',
    storeName: 'Sharma Kirana Store',
    storeSlug: 'sharma-kirana',
    cartId: 'cart-1',
    lines,
    totals: {
      subtotalPaise: subtotal,
      discountPaise: 0,
      deliveryFeePaise: 0,
      taxPaise: 0,
      totalPaise: subtotal,
      itemCount: lines.length,
      totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    },
    issues: [],
    isCheckoutReady: lines.length > 0,
    ...overrides,
  };
};

export const emptyCartFixture = () =>
  cartFixture({
    lines: [],
    totals: {
      subtotalPaise: 0,
      discountPaise: 0,
      deliveryFeePaise: 0,
      taxPaise: 0,
      totalPaise: 0,
      itemCount: 0,
      totalQuantity: 0,
    },
    isCheckoutReady: false,
  });

/** A saved address, as GET /addresses returns one. */
export const addressFixture = (overrides = {}) => ({
  id: 'addr-1',
  label: 'Home',
  recipientName: 'Test Customer',
  phone: '+919876543210',
  line1: '221B Model Town',
  line2: null,
  landmark: null,
  city: 'Ludhiana',
  state: 'Punjab',
  postalCode: '141002',
  country: 'IN',
  latitude: null,
  longitude: null,
  isDefault: true,
  createdAt: '2026-09-19T16:05:06.505623+00:00',
  updatedAt: '2026-09-19T16:05:06.505623+00:00',
  ...overrides,
});

/** The checkout quote — the single gate every order passes through. */
export const quoteFixture = (overrides = {}) => ({
  storeId: '11111111-1111-4111-8111-000000000001',
  cartId: 'cart-1',
  store: {
    id: '11111111-1111-4111-8111-000000000001',
    slug: 'sharma-kirana',
    name: 'Sharma Kirana Store',
    phone: '+919812345601',
    addressLine1: '14 Model Town Road',
    city: 'Ludhiana',
    state: 'Punjab',
    postalCode: '141002',
  },
  hours: { isOpen: true, opensAt: null },
  fulfilmentMode: 'pickup',
  address: null,
  customerNote: null,
  lines: [
    {
      id: 'line-1',
      name: 'Basmati Rice',
      variantName: null,
      unitPricePaise: 12900,
      quantity: 2,
      lineTotalPaise: 25800,
      issues: [],
    },
  ],
  unavailableLines: [],
  totals: {
    subtotalPaise: 25800,
    discountPaise: 0,
    deliveryFeePaise: 0,
    taxPaise: 0,
    totalPaise: 25800,
    itemCount: 1,
    totalQuantity: 2,
  },
  blockers: [],
  warnings: [],
  canPlaceOrder: true,
  ...overrides,
});

export const paymentMethodsFixture = () => ({
  methods: [
    {
      code: 'cash',
      label: 'Cash on pickup / delivery',
      description: 'Pay the store directly when you collect or receive your order.',
      requiresOnlineFlow: false,
    },
    {
      code: 'online',
      label: 'Pay online',
      description: 'Card, UPI or net banking through our payment partner.',
      requiresOnlineFlow: true,
    },
  ],
});

/** An order, as POST /orders returns one. */
export const orderFixture = (overrides = {}) => ({
  id: 'order-1',
  orderNumber: 'CPSE-260920-ABC123',
  storeId: '11111111-1111-4111-8111-000000000001',
  storeName: 'Sharma Kirana Store',
  fulfilmentMode: 'pickup',
  status: 'placed',
  statusLabel: 'Order placed',
  paymentStatus: 'pending',
  totalPaise: 25800,
  itemCount: 1,
  totals: { subtotalPaise: 25800, discountPaise: 0, deliveryFeePaise: 0, taxPaise: 0, totalPaise: 25800 },
  ...overrides,
});

/** An order item, as the order detail returns one. */
export const orderItemFixture = (overrides = {}) => ({
  id: 'oi-1',
  productId: '31111111-1111-4111-8111-000000000001',
  variantId: null,
  name: 'Basmati Rice',
  variantName: null,
  imageUrl: 'https://images.cpse.local/products/basmati-1.jpg',
  unitPricePaise: 12900,
  quantity: 2,
  lineTotalPaise: 25800,
  ...overrides,
});

/**
 * The order detail, with the timeline the server builds.
 *
 * `steps` is the path *this* order takes — a pickup order has no
 * "out for delivery" step — so a fixture carries the pickup path by default.
 */
export const orderDetailFixture = (overrides = {}) => ({
  ...orderFixture(),
  placedAt: '2026-09-20T16:17:28.490933+00:00',
  completedAt: null,
  cancelledAt: null,
  isCancellable: true,
  items: [orderItemFixture()],
  totals: {
    subtotalPaise: 25800,
    discountPaise: 0,
    deliveryFeePaise: 0,
    taxPaise: 0,
    totalPaise: 25800,
  },
  fulfilment: {
    mode: 'pickup',
    pickupFrom: {
      id: '11111111-1111-4111-8111-000000000001',
      name: 'Sharma Kirana Store',
      slug: 'sharma-kirana',
      phone: '+919812345601',
      addressLine1: '14 Model Town Road',
      addressLine2: 'Near Gurudwara',
      city: 'Ludhiana',
      state: 'Punjab',
      postalCode: '141002',
    },
  },
  store: {
    id: '11111111-1111-4111-8111-000000000001',
    name: 'Sharma Kirana Store',
    slug: 'sharma-kirana',
    phone: '+919812345601',
    addressLine1: '14 Model Town Road',
    city: 'Ludhiana',
    state: 'Punjab',
    postalCode: '141002',
  },
  payment: null,
  customerNote: null,
  cancellationReason: null,
  timeline: {
    steps: [
      { status: 'placed', label: 'Order placed', reachedAt: '2026-09-20T16:17:28.490933+00:00', isCurrent: true },
      { status: 'accepted', label: 'Accepted by the store', reachedAt: null, isCurrent: false },
      { status: 'preparing', label: 'Being prepared', reachedAt: null, isCurrent: false },
      { status: 'ready_for_pickup', label: 'Ready for pickup', reachedAt: null, isCurrent: false },
      { status: 'completed', label: 'Completed', reachedAt: null, isCurrent: false },
    ],
    history: [
      {
        fromStatus: null,
        toStatus: 'placed',
        label: 'Order placed',
        note: 'Order placed',
        at: '2026-09-20T16:17:28.490933+00:00',
      },
    ],
  },
  ...overrides,
});

/** The receipt payload. */
export const receiptFixture = (overrides = {}) => ({
  orderNumber: 'CPSE-260920-ABC123',
  placedAt: '2026-09-20T16:17:28.490933+00:00',
  status: 'placed',
  store: orderDetailFixture().store,
  customerNote: null,
  fulfilment: orderDetailFixture().fulfilment,
  items: [orderItemFixture()],
  totals: orderDetailFixture().totals,
  payment: { method: 'cash', status: 'pending' },
  ...overrides,
});

/** A saved-store row, as GET /saved-stores returns one. */
export const savedStoreFixture = (overrides = {}) => ({
  savedAt: '2026-09-20T10:00:00.000Z',
  store: storeFixture(),
  ...overrides,
});

/** A notification. Payloads carry deep-link ids and nothing else. */
export const notificationFixture = (overrides = {}) => ({
  id: 'notif-1',
  type: 'order_status_changed',
  title: 'Order CPSE-260920-ABC123: accepted by the store',
  body: 'The store has accepted your order.',
  payload: {
    order_id: 'order-1',
    order_number: 'CPSE-260920-ABC123',
    store_id: '11111111-1111-4111-8111-000000000001',
    status: 'accepted',
  },
  isRead: false,
  readAt: null,
  createdAt: '2026-09-20T16:20:00.000Z',
  ...overrides,
});

/** A khata account in the list. */
export const khataAccountFixture = (overrides = {}) => ({
  id: 'khata-1',
  storeId: '11111111-1111-4111-8111-000000000001',
  store: {
    id: '11111111-1111-4111-8111-000000000001',
    slug: 'sharma-kirana',
    name: 'Sharma Kirana Store',
    logoUrl: null,
  },
  balancePaise: 2940,
  outstandingPaise: 2940,
  creditPaise: 0,
  isSettled: false,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
  ...overrides,
});

/** A ledger entry. `signedAmountPaise` is signed by the server. */
export const khataTxnFixture = (overrides = {}) => ({
  id: 'txn-1',
  type: 'debit',
  amountPaise: 2500,
  signedAmountPaise: 2500,
  description: 'Groceries on credit',
  orderId: null,
  occurredAt: '2026-08-02T10:15:00.000Z',
  ...overrides,
});

/** The statement payload, which also serves as the whole-history view. */
export const khataStatementFixture = (overrides = {}) => ({
  account: khataAccountFixture(),
  period: { from: null, to: null },
  totals: {
    openingPaise: 0,
    debitPaise: 4940,
    creditPaise: 2000,
    closingPaise: 2940,
    transactionCount: 2,
  },
  transactions: [
    khataTxnFixture(),
    khataTxnFixture({
      id: 'txn-2',
      type: 'credit',
      amountPaise: 2000,
      signedAmountPaise: -2000,
      description: 'Part payment (UPI)',
      occurredAt: '2026-08-20T10:00:00.000Z',
    }),
  ],
  ...overrides,
});
