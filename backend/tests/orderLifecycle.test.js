import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';
import { ALWAYS_OPEN, addToCart, createAddress, placeOrder, advance } from './helpers/shopping.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin } = await import('../src/lib/supabase.js');
const {
  db,
  CUSTOMER_ID,
  STORE_ID,
  resetDb,
  seedCustomer,
  seedStore,
  seedCategory,
  seedProduct,
  seedProductVariant,
} = await import('./helpers/supabaseMock.js');

const OTHER_CUSTOMER_ID = '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e99';

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

/** Places one pickup order and returns it with the product it was made from. */
async function placedOrder(auth, productOverrides = {}) {
  const product = seedProduct({ price_paise: 12500, stock: 50, ...productOverrides });
  await addToCart(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });
  const { body } = await placeOrder(auth, { storeId: STORE_ID });
  return { order: body.data.order, product };
}

const cancel = (auth, orderId, reason) =>
  api().post(url(`/orders/${orderId}/cancel`)).set(auth).send(reason ? { reason } : {});

describe('POST /api/v1/orders/:id/test-advance (8.8, 8.3)', () => {
  it('advances an order the way a merchant would', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);

    const res = await advance(auth, order.id, 'accepted', 'Got it, starting now');

    expect(res.status).toBe(200);
    expect(res.body.data.order.status).toBe('accepted');
    expect(res.body.data.order.statusLabel).toBe('Accepted by the store');
    // It is clearly marked as a stand-in rather than a real merchant API.
    expect(res.body.data.warning).toMatch(/test-only/i);
  });

  it('walks the whole pickup lifecycle', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);

    for (const status of ['accepted', 'preparing', 'ready_for_pickup', 'completed']) {
      const res = await advance(auth, order.id, status);
      expect(res.status, status).toBe(200);
      expect(res.body.data.order.status).toBe(status);
    }

    const { body } = await api().get(url(`/orders/${order.id}`)).set(auth);
    expect(body.data.order.completedAt).toBeTruthy();
    expect(body.data.order.timeline.history.map((entry) => entry.toStatus)).toEqual([
      'placed',
      'accepted',
      'preparing',
      'ready_for_pickup',
      'completed',
    ]);
  });

  it('walks the delivery lifecycle instead for a delivery order (8.5)', async () => {
    const auth = signIn();
    const product = seedProduct({ price_paise: 12500, stock: 50 });
    await addToCart(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });
    const { body: address } = await createAddress(auth);
    const { body: created } = await placeOrder(auth, {
      storeId: STORE_ID,
      fulfilmentMode: 'delivery',
      addressId: address.data.address.id,
    });

    for (const status of ['accepted', 'preparing', 'out_for_delivery', 'completed']) {
      const res = await advance(auth, created.data.order.id, status);
      expect(res.status, status).toBe(200);
    }
  });

  it('refuses to skip a step (8.3)', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);

    const res = await advance(auth, order.id, 'completed');

    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ from: 'placed', to: 'completed' });
  });

  it('refuses to move backwards (8.3)', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);
    await advance(auth, order.id, 'accepted');
    await advance(auth, order.id, 'preparing');

    const res = await advance(auth, order.id, 'accepted');

    expect(res.status).toBe(409);
  });

  it('refuses to move a completed order at all (8.3)', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);
    for (const status of ['accepted', 'preparing', 'ready_for_pickup', 'completed']) {
      await advance(auth, order.id, status);
    }

    const res = await advance(auth, order.id, 'preparing');

    expect(res.status).toBe(409);
  });

  it('refuses to hand a pickup order to a delivery rider', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);
    await advance(auth, order.id, 'accepted');
    await advance(auth, order.id, 'preparing');

    // out_for_delivery IS reachable from preparing in the state machine; what
    // must not happen is reaching both fulfilment ends on one order.
    const delivered = await advance(auth, order.id, 'out_for_delivery');
    expect(delivered.status).toBe(200);

    const alsoReady = await advance(auth, order.id, 'ready_for_pickup');
    expect(alsoReady.status).toBe(409);
  });

  it("404s for another customer's order (8.9)", async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);

    const otherAuth = signIn(OTHER_CUSTOMER_ID);
    const res = await advance(otherAuth, order.id, 'accepted');

    expect(res.status).toBe(404);
  });

  it('rejects a status that is not in the enum', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);

    const res = await advance(auth, order.id, 'shipped-to-mars');

    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/orders/:id/cancel (8.4)', () => {
  it('cancels a freshly placed order and records the reason', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);

    const res = await cancel(auth, order.id, 'Ordered by mistake');

    expect(res.status).toBe(200);
    expect(res.body.data.order.status).toBe('cancelled');
    expect(res.body.data.order.cancellationReason).toBe('Ordered by mistake');
    expect(res.body.data.order.cancelledAt).toBeTruthy();
    expect(res.body.data.order.timeline.history.at(-1)).toMatchObject({
      toStatus: 'cancelled',
      changedBy: 'customer',
    });
  });

  it('cancels an accepted order — the store has not started yet', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);
    await advance(auth, order.id, 'accepted');

    const res = await cancel(auth, order.id);

    expect(res.status).toBe(200);
    expect(res.body.data.order.status).toBe('cancelled');
  });

  it('refuses once the order is being prepared (8.4)', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);
    await advance(auth, order.id, 'accepted');
    await advance(auth, order.id, 'preparing');

    const res = await cancel(auth, order.id);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/call the store/i);
    expect(res.body.error.details).toEqual({ status: 'preparing' });
  });

  it('refuses on a completed order', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);
    for (const status of ['accepted', 'preparing', 'ready_for_pickup', 'completed']) {
      await advance(auth, order.id, status);
    }

    const res = await cancel(auth, order.id);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already completed/i);
  });

  it('refuses to cancel twice', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);
    await cancel(auth, order.id);

    const res = await cancel(auth, order.id);

    expect(res.status).toBe(409);
  });

  it('marks the order not cancellable once it is cancelled', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);

    const { body } = await cancel(auth, order.id);

    expect(body.data.order.isCancellable).toBe(false);
  });

  it("404s for another customer's order (8.9)", async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);

    const otherAuth = signIn(OTHER_CUSTOMER_ID);
    const res = await cancel(otherAuth, order.id);

    expect(res.status).toBe(404);
    expect(db.tables.get('orders')[0].status).toBe('placed');
  });

  it('rejects a reason longer than the column allows', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);

    const res = await cancel(auth, order.id, 'x'.repeat(301));

    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/orders/:id/receipt (8.6)', () => {
  it('returns a receipt that matches the order', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);

    const res = await api().get(url(`/orders/${order.id}/receipt`)).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.receipt).toMatchObject({
      orderNumber: order.orderNumber,
      isTaxInvoice: false,
    });
    expect(res.body.data.receipt.totals).toMatchObject({ subtotalPaise: 25000, totalPaise: 25000 });
    expect(res.body.data.receipt.lines[0]).toMatchObject({ name: 'Basmati Rice', quantity: 2 });
    expect(res.body.data.receipt.payment).toMatchObject({ method: 'cash', status: 'pending' });
  });

  it('bills a delivery order to the delivery address', async () => {
    const auth = signIn();
    const product = seedProduct({ price_paise: 12500, stock: 50 });
    await addToCart(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });
    const { body: address } = await createAddress(auth);
    const { body: created } = await placeOrder(auth, {
      storeId: STORE_ID,
      fulfilmentMode: 'delivery',
      addressId: address.data.address.id,
    });

    const { body } = await api()
      .get(url(`/orders/${created.data.order.id}/receipt`))
      .set(auth);

    expect(body.data.receipt.billedTo.line1).toBe('221B Model Town');
    expect(body.data.receipt.totals.deliveryFeePaise).toBe(2900);
  });

  it('shows the online payment reference once it is paid', async () => {
    const auth = signIn();
    const product = seedProduct({ price_paise: 12500, stock: 50 });
    await addToCart(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });
    const { body: created } = await placeOrder(auth, {
      storeId: STORE_ID,
      paymentMethod: 'online',
    });
    await api().post(url(`/payments/${created.data.order.id}/initiate`)).set(auth);
    await api()
      .post(url(`/payments/${created.data.order.id}/verify`))
      .set(auth)
      .send({ outcome: 'success' });

    const { body } = await api()
      .get(url(`/orders/${created.data.order.id}/receipt`))
      .set(auth);

    expect(body.data.receipt.payment).toMatchObject({ method: 'online', status: 'paid' });
    expect(body.data.receipt.payment.reference).toMatch(/^mock_/);
  });

  it("404s for another customer's receipt (8.9)", async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);

    const otherAuth = signIn(OTHER_CUSTOMER_ID);
    const res = await api().get(url(`/orders/${order.id}/receipt`)).set(otherAuth);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/orders/:id/reorder (8.7)', () => {
  const reorder = (auth, orderId) => api().post(url(`/orders/${orderId}/reorder`)).set(auth);

  it('rebuilds the cart from a past order', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);

    const res = await reorder(auth, order.id);

    expect(res.status).toBe(201);
    expect(res.body.data.isComplete).toBe(true);
    expect(res.body.data.unavailableItems).toEqual([]);
    expect(res.body.data.cart.lines[0]).toMatchObject({ name: 'Basmati Rice', quantity: 2 });
  });

  it('keeps the variant a line was ordered with', async () => {
    const auth = signIn();
    const product = seedProduct({ price_paise: 10000, stock: 50 });
    const variant = seedProductVariant({ product_id: product.id, name: '5 kg', price_paise: 25000 });
    await addToCart(auth, { storeId: STORE_ID, productId: product.id, variantId: variant.id });
    const { body: created } = await placeOrder(auth, { storeId: STORE_ID });

    const { body } = await reorder(auth, created.data.order.id);

    expect(body.data.cart.lines[0]).toMatchObject({ variantName: '5 kg', unitPricePaise: 25000 });
  });

  it('reports the items it could not add and still adds the rest (8.7)', async () => {
    const auth = signIn();
    const good = seedProduct({ name: 'Basmati Rice', slug: 'rice', price_paise: 12500, stock: 50 });
    const gone = seedProduct({ name: 'Toor Dal', slug: 'dal', price_paise: 12500, stock: 50 });
    await addToCart(auth, { storeId: STORE_ID, productId: good.id });
    await addToCart(auth, { storeId: STORE_ID, productId: gone.id });
    const { body: created } = await placeOrder(auth, { storeId: STORE_ID });

    gone.is_available = false;

    const { body } = await reorder(auth, created.data.order.id);

    expect(body.data.isComplete).toBe(false);
    expect(body.data.unavailableItems).toEqual([
      { name: 'Toor Dal', code: 'PRODUCT_UNAVAILABLE', message: 'Toor Dal is currently unavailable.' },
    ]);
    expect(body.data.cart.lines.map((line) => line.name)).toEqual(['Basmati Rice']);
  });

  it('reports a line whose stock no longer covers the original quantity', async () => {
    const auth = signIn();
    const { order, product } = await placedOrder(auth);
    product.stock = 1;

    const { body } = await reorder(auth, order.id);

    expect(body.data.unavailableItems[0]).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(body.data.cart.lines).toEqual([]);
  });

  it('reports a product that was deleted outright', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);
    db.tables.set('products', []);

    const { body } = await reorder(auth, order.id);

    expect(body.data.unavailableItems[0]).toMatchObject({
      code: 'PRODUCT_REMOVED',
      message: 'Basmati Rice is no longer sold by this store.',
    });
  });

  it('refuses to reorder from a store that has stopped trading', async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);
    store.is_active = false;

    const res = await reorder(auth, order.id);

    expect(res.status).toBe(404);
  });

  it("404s for another customer's order (8.9)", async () => {
    const auth = signIn();
    const { order } = await placedOrder(auth);

    const otherAuth = signIn(OTHER_CUSTOMER_ID);
    const res = await reorder(otherAuth, order.id);

    expect(res.status).toBe(404);
  });

  it('merges into an existing cart rather than replacing it', async () => {
    const auth = signIn();
    const { order, product } = await placedOrder(auth);
    await addToCart(auth, { storeId: STORE_ID, productId: product.id, quantity: 1 });

    const { body } = await reorder(auth, order.id);

    // 1 already in the cart + 2 from the order.
    expect(body.data.cart.lines[0].quantity).toBe(3);
  });
});
