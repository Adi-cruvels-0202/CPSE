import { api, url } from './app.js';
import { db, seedMerchant, STORE_ID } from './supabaseMock.js';

/**
 * The customer journey, as a handful of calls. Store discovery → cart →
 * address → checkout → order is the same sequence in almost every order,
 * payment and lifecycle test, so it lives here rather than being retyped.
 */

/** Open all week, so an open/closed check never makes a test time-dependent. */
export const ALWAYS_OPEN = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [
    day,
    [{ open: '00:00', close: '23:59' }],
  ]),
);

export const addToCart = (auth, body) => api().post(url('/cart/items')).set(auth).send(body);

export const createAddress = (auth, overrides = {}) =>
  api()
    .post(url('/addresses'))
    .set(auth)
    .send({
      recipientName: 'Aditya Suresh',
      phone: '+919876543210',
      line1: '221B Model Town',
      city: 'Ludhiana',
      state: 'Punjab',
      postalCode: '141002',
      ...overrides,
    });

export const quote = (auth, body) => api().post(url('/checkout/quote')).set(auth).send(body);

export function placeOrder(auth, body, { idempotencyKey } = {}) {
  const request = api().post(url('/orders')).set(auth);
  if (idempotencyKey) request.set('Idempotency-Key', idempotencyKey);
  return request.send({ fulfilmentMode: 'pickup', paymentMethod: 'cash', ...body });
}

export const getOrder = (auth, orderId) => api().get(url(`/orders/${orderId}`)).set(auth);

/**
 * Moves an order the way its merchant would, through the real merchant
 * endpoints (MERCHANT_API.md, Orders). Tests sign one person in for both sides,
 * so that person is made the store's merchant first — exactly the "one login,
 * customer and merchant" case D-2 allows.
 *
 * `status` is where the order should end up; the matching action is chosen:
 * accept, reject, complete, cancel, or a step in between.
 */
export async function advance(auth, orderId, status, note) {
  const order = (db.tables.get('orders') ?? []).find((row) => row.id === orderId);
  const storeId = order?.store_id ?? STORE_ID;
  if (order) actAsMerchantOf(storeId, order.customer_id);

  const base = `/merchant/stores/${storeId}/orders/${orderId}`;
  const [path, body] = {
    accepted: ['/accept', {}],
    rejected: ['/reject', note ? { reason: note } : {}],
    completed: ['/complete', {}],
    cancelled: ['/cancel', { reason: note ?? 'Cancelled by the store' }],
  }[status] ?? ['/status', { status }];

  return api().post(url(`${base}${path}`)).set(auth).send(body);
}

/** Gives `userId` a merchant profile, if missing, and makes them own `storeId`. */
export function actAsMerchantOf(storeId, userId) {
  if (!(db.tables.get('merchants') ?? []).some((row) => row.id === userId)) {
    seedMerchant({ id: userId });
  }
  const store = (db.tables.get('stores') ?? []).find((row) => row.id === storeId);
  if (store) store.owner_id = userId;
}
