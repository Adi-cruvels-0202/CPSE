import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin } = await import('../src/lib/supabase.js');
const {
  CUSTOMER_ID,
  STORE_ID,
  resetDb,
  seedCustomer,
  seedStore,
  seedCategory,
  seedProduct,
} = await import('./helpers/supabaseMock.js');

const OTHER_CUSTOMER_ID = '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e99';

/** The store is open all week, so open/closed never makes these tests flaky. */
const ALWAYS_OPEN = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [
    day,
    [{ open: '00:00', close: '23:59' }],
  ]),
);

/** The single seeded store row, mutated in place the way a merchant edit would. */
let store;

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  seedCustomer();
  seedCustomer({ id: OTHER_CUSTOMER_ID, email: 'other@cpse.local' });
  store = seedStore({ opening_hours: ALWAYS_OPEN, min_order_paise: 19900, delivery_fee_paise: 2900 });
  seedCategory();
});

function signIn(id = CUSTOMER_ID) {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  return { Authorization: 'Bearer token-abc' };
}

const addItem = (auth, body) => api().post(url('/cart/items')).set(auth).send(body);

const quote = (auth, body) => api().post(url('/checkout/quote')).set(auth).send(body);

const createAddress = (auth, overrides = {}) =>
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

/** A cart worth 25 000 paise — comfortably over the 19 900 minimum. */
async function stockedCart(auth, { price = 12500, quantity = 2, ...product } = {}) {
  const row = seedProduct({ price_paise: price, stock: 50, ...product });
  await addItem(auth, { storeId: STORE_ID, productId: row.id, quantity });
  return row;
}

describe('POST /api/v1/checkout/quote (6.7)', () => {
  it('requires a signed-in customer', async () => {
    const res = await api().post(url('/checkout/quote')).send({
      storeId: STORE_ID,
      fulfilmentMode: 'pickup',
    });

    expect(res.status).toBe(401);
  });

  it('prices a pickup order with no delivery fee', async () => {
    const auth = signIn();
    await stockedCart(auth);

    const res = await quote(auth, { storeId: STORE_ID, fulfilmentMode: 'pickup' });

    expect(res.status).toBe(200);
    expect(res.body.data.quote.totals).toMatchObject({
      subtotalPaise: 25000,
      discountPaise: 0,
      deliveryFeePaise: 0,
      taxPaise: 0,
      totalPaise: 25000,
    });
    expect(res.body.data.quote.canPlaceOrder).toBe(true);
    expect(res.body.data.quote.address).toBeNull();
  });

  it("adds the store's delivery fee for a delivery order (6.7)", async () => {
    const auth = signIn();
    await stockedCart(auth);
    const { body: address } = await createAddress(auth);

    const { body } = await quote(auth, {
      storeId: STORE_ID,
      fulfilmentMode: 'delivery',
      addressId: address.data.address.id,
    });

    expect(body.data.quote.totals).toMatchObject({
      subtotalPaise: 25000,
      deliveryFeePaise: 2900,
      totalPaise: 27900,
    });
    expect(body.data.quote.address.line1).toBe('221B Model Town');
    expect(body.data.quote.canPlaceOrder).toBe(true);
  });

  it('carries the store snapshot so a pickup order knows where to go', async () => {
    const auth = signIn();
    await stockedCart(auth);

    const { body } = await quote(auth, { storeId: STORE_ID, fulfilmentMode: 'pickup' });

    expect(body.data.quote.store).toMatchObject({
      id: STORE_ID,
      name: 'Sharma Kirana Store',
      phone: '+919812345601',
    });
  });

  it('never exposes the internal pricing handle to the client', async () => {
    const auth = signIn();
    await stockedCart(auth);

    const { body } = await quote(auth, { storeId: STORE_ID, fulfilmentMode: 'pickup' });

    expect(body.data.quote).not.toHaveProperty('_internal');
  });

  it('blocks an empty cart', async () => {
    const auth = signIn();

    const { body } = await quote(auth, { storeId: STORE_ID, fulfilmentMode: 'pickup' });

    expect(body.data.quote.canPlaceOrder).toBe(false);
    expect(body.data.quote.blockers[0].code).toBe('CART_EMPTY');
  });

  it('blocks pickup when the store does not offer it (6.8)', async () => {
    const auth = signIn();
    store.pickup_enabled = false;
    await stockedCart(auth);

    const { body } = await quote(auth, { storeId: STORE_ID, fulfilmentMode: 'pickup' });

    expect(body.data.quote.blockers.map((blocker) => blocker.code)).toContain('PICKUP_UNAVAILABLE');
    expect(body.data.quote.canPlaceOrder).toBe(false);
  });

  it('blocks delivery when the store does not offer it (6.8)', async () => {
    const auth = signIn();
    store.delivery_enabled = false;
    await stockedCart(auth);
    const { body: address } = await createAddress(auth);

    const { body } = await quote(auth, {
      storeId: STORE_ID,
      fulfilmentMode: 'delivery',
      addressId: address.data.address.id,
    });

    expect(body.data.quote.blockers.map((blocker) => blocker.code)).toContain(
      'DELIVERY_UNAVAILABLE',
    );
  });

  it('blocks delivery with no address chosen (6.8)', async () => {
    const auth = signIn();
    await stockedCart(auth);

    const { body } = await quote(auth, { storeId: STORE_ID, fulfilmentMode: 'delivery' });

    expect(body.data.quote.blockers[0].code).toBe('ADDRESS_REQUIRED');
  });

  it("404s on another customer's address rather than pricing it", async () => {
    signIn(OTHER_CUSTOMER_ID);
    const { body: foreign } = await createAddress({ Authorization: 'Bearer other' });

    const auth = signIn();
    await stockedCart(auth);

    const res = await quote(auth, {
      storeId: STORE_ID,
      fulfilmentMode: 'delivery',
      addressId: foreign.data.address.id,
    });

    expect(res.status).toBe(404);
  });

  it('blocks an order under the store minimum, measured on the subtotal (6.9)', async () => {
    const auth = signIn();
    await stockedCart(auth, { price: 5000, quantity: 1 });
    const { body: address } = await createAddress(auth);

    const { body } = await quote(auth, {
      storeId: STORE_ID,
      fulfilmentMode: 'delivery',
      addressId: address.data.address.id,
    });

    const blocker = body.data.quote.blockers.find(
      (item) => item.code === 'MINIMUM_ORDER_NOT_MET',
    );
    // The 2 900 delivery fee must not be what lifts the order over the floor.
    expect(blocker).toMatchObject({ minOrderPaise: 19900, shortfallPaise: 14900 });
    expect(body.data.quote.canPlaceOrder).toBe(false);
  });

  it('accepts an order exactly on the minimum', async () => {
    const auth = signIn();
    await stockedCart(auth, { price: 19900, quantity: 1 });

    const { body } = await quote(auth, { storeId: STORE_ID, fulfilmentMode: 'pickup' });

    expect(body.data.quote.canPlaceOrder).toBe(true);
  });

  it('blocks an unavailable line and reports which one', async () => {
    const auth = signIn();
    const product = await stockedCart(auth);
    product.is_available = false;

    const { body } = await quote(auth, { storeId: STORE_ID, fulfilmentMode: 'pickup' });

    expect(body.data.quote.canPlaceOrder).toBe(false);
    expect(body.data.quote.blockers[0].code).toBe('PRODUCT_UNAVAILABLE');
    expect(body.data.quote.unavailableLines).toHaveLength(1);
    expect(body.data.quote.lines).toEqual([]);
  });

  it('prices only the purchasable lines when part of the cart went unavailable', async () => {
    const auth = signIn();
    await stockedCart(auth, { price: 19900, quantity: 1, slug: 'good' });
    const bad = await stockedCart(auth, { price: 5000, quantity: 1, slug: 'bad', name: 'Toor Dal' });
    bad.is_available = false;

    const { body } = await quote(auth, { storeId: STORE_ID, fulfilmentMode: 'pickup' });

    expect(body.data.quote.totals.subtotalPaise).toBe(19900);
    expect(body.data.quote.lines).toHaveLength(1);
  });

  it('warns rather than blocks when the store is closed (D29)', async () => {
    const auth = signIn();
    store.opening_hours = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
    await stockedCart(auth);

    const { body } = await quote(auth, { storeId: STORE_ID, fulfilmentMode: 'pickup' });

    expect(body.data.quote.hours.isOpen).toBe(false);
    expect(body.data.quote.warnings.map((warning) => warning.code)).toContain('STORE_CLOSED');
    expect(body.data.quote.canPlaceOrder).toBe(true);
  });

  it('rejects a fulfilment mode that is neither pickup nor delivery', async () => {
    const auth = signIn();

    const res = await quote(auth, { storeId: STORE_ID, fulfilmentMode: 'teleport' });

    expect(res.status).toBe(422);
  });

  it('rejects a note longer than the column allows', async () => {
    const auth = signIn();

    const res = await quote(auth, {
      storeId: STORE_ID,
      fulfilmentMode: 'pickup',
      customerNote: 'x'.repeat(501),
    });

    expect(res.status).toBe(422);
  });

  it('404s for an unknown store', async () => {
    const auth = signIn();

    const res = await quote(auth, {
      storeId: '11111111-1111-4111-8111-000000000404',
      fulfilmentMode: 'pickup',
    });

    expect(res.status).toBe(404);
  });

  it('changes nothing — quoting twice leaves the cart as it was', async () => {
    const auth = signIn();
    await stockedCart(auth);

    await quote(auth, { storeId: STORE_ID, fulfilmentMode: 'pickup' });
    await quote(auth, { storeId: STORE_ID, fulfilmentMode: 'pickup' });

    const { body } = await api().get(url(`/cart?storeId=${STORE_ID}`)).set(auth);
    expect(body.data.cart.lines).toHaveLength(1);
    expect(body.data.cart.lines[0].quantity).toBe(2);
  });
});
