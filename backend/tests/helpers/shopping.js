import { api, url } from './app.js';
import { db, seedMerchant, seedCustomer, STORE_ID, SHOPPER_ID, SHOP_OWNER_ID } from './supabaseMock.js';
import { supabaseAdmin } from '../../src/lib/supabase.js';

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
 * endpoints (MERCHANT_API.md, Orders). A shop account cannot shop (D-2,
 * revised), so the store's merchant is its own login: this request alone is
 * signed in as the store's owner — SHOP_OWNER_ID, made the owner first, when
 * no merchant owns it yet. `auth` is accepted for the callers' convenience
 * and not used.
 *
 * `status` is where the order should end up; the matching action is chosen:
 * accept, reject, complete, cancel, or a step in between.
 */
export async function advance(_auth, orderId, status, note) {
  const order = (db.tables.get('orders') ?? []).find((row) => row.id === orderId);
  const storeId = order?.store_id ?? STORE_ID;
  const store = (db.tables.get('stores') ?? []).find((row) => row.id === storeId);
  const ownedByMerchant = (db.tables.get('merchants') ?? []).some((row) => row.id === store?.owner_id);
  const ownerId = ownedByMerchant ? store.owner_id : SHOP_OWNER_ID;
  if (!ownedByMerchant) actAsMerchantOf(storeId, ownerId);

  const base = `/merchant/stores/${storeId}/orders/${orderId}`;
  const [path, body] = {
    accepted: ['/accept', {}],
    rejected: ['/reject', note ? { reason: note } : {}],
    completed: ['/complete', {}],
    cancelled: ['/cancel', { reason: note ?? 'Cancelled by the store' }],
  }[status] ?? ['/status', { status }];

  supabaseAdmin.auth.getUser.mockResolvedValueOnce({ data: { user: { id: ownerId } }, error: null });
  return api().post(url(`${base}${path}`)).set({ Authorization: 'Bearer shop-owner-token' }).send(body);
}

/** Gives `userId` a merchant profile, if missing, and makes them own `storeId`. */
export function actAsMerchantOf(storeId, userId) {
  if (!(db.tables.get('customers') ?? []).some((row) => row.id === userId)) {
    // Every auth user has a customers row (the signup trigger), shops included.
    seedCustomer({ id: userId, email: `${userId.slice(0, 8)}@shop.cpse.local` });
  }
  if (!(db.tables.get('merchants') ?? []).some((row) => row.id === userId)) {
    seedMerchant({ id: userId, email: `${userId.slice(0, 8)}@shop.cpse.local` });
  }
  const store = (db.tables.get('stores') ?? []).find((row) => row.id === storeId);
  if (store) store.owner_id = userId;
}

/**
 * Signs in a customer who is not a shop, for merchant tests where someone has
 * to place an order. Later requests that call the test's own signIn() go back
 * to the shop account.
 */
export function asShopper() {
  if (!(db.tables.get('customers') ?? []).some((row) => row.id === SHOPPER_ID)) {
    seedCustomer({ id: SHOPPER_ID, email: 'shopper@cpse.local', full_name: 'Test Shopper', phone: '+919800000001' });
  }
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: SHOPPER_ID } }, error: null });
  return { Authorization: 'Bearer shopper-token' };
}
