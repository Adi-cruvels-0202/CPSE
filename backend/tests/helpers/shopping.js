import { api, url } from './app.js';

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

/** Marches an order forward through the test-only merchant endpoint (8.8). */
export const advance = (auth, orderId, status, note) =>
  api().post(url(`/orders/${orderId}/test-advance`)).set(auth).send({ status, note });
