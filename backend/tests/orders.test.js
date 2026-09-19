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
  seedProductImage,
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

/** A cart of 25 000 paise, comfortably over the store's 19 900 minimum. */
async function readyCart(auth, overrides = {}) {
  const product = seedProduct({ price_paise: 12500, stock: 50, ...overrides });
  await addToCart(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });
  return product;
}

describe('POST /api/v1/orders (7.4, 7.7, 7.9)', () => {
  it('requires a signed-in customer', async () => {
    const res = await api().post(url('/orders')).send({
      storeId: STORE_ID,
      fulfilmentMode: 'pickup',
      paymentMethod: 'cash',
    });

    expect(res.status).toBe(401);
  });

  it('creates a cash order, placed immediately', async () => {
    const auth = signIn();
    await readyCart(auth);

    const res = await placeOrder(auth, { storeId: STORE_ID });

    expect(res.status).toBe(201);
    expect(res.body.data.order).toMatchObject({
      status: 'placed',
      paymentStatus: 'pending',
      fulfilmentMode: 'pickup',
      totalPaise: 25000,
      itemCount: 1,
    });
    expect(res.body.data.order.orderNumber).toMatch(/^CPSE-/);
    expect(res.body.data.replayed).toBe(false);
  });

  it('leaves an online order awaiting payment until the provider confirms (7.13)', async () => {
    const auth = signIn();
    await readyCart(auth);

    const { body } = await placeOrder(auth, { storeId: STORE_ID, paymentMethod: 'online' });

    expect(body.data.order.status).toBe('pending_payment');
    expect(body.data.order.paymentStatus).toBe('pending');
    // The payment intent is created in the same transaction (7.6).
    expect(body.data.order.payment).toMatchObject({ provider: 'mock', amountPaise: 25000 });
  });

  it('snapshots the product name and price onto the order (7.7, D11)', async () => {
    const auth = signIn();
    const product = await readyCart(auth, { name: 'Basmati Rice' });
    seedProductImage({ product_id: product.id, url: 'https://img/rice.jpg' });

    const { body } = await placeOrder(auth, { storeId: STORE_ID });

    // The merchant renames and reprices afterwards.
    product.name = 'Premium Basmati';
    product.price_paise = 99900;

    const after = await api().get(url(`/orders/${body.data.order.id}`)).set(auth);
    expect(after.body.data.order.items[0]).toMatchObject({
      name: 'Basmati Rice',
      unitPricePaise: 12500,
      quantity: 2,
      lineTotalPaise: 25000,
    });
  });

  it('snapshots the variant name and the store contact', async () => {
    const auth = signIn();
    const product = seedProduct({ price_paise: 10000, stock: 50 });
    const variant = seedProductVariant({ product_id: product.id, name: '5 kg', price_paise: 25000 });
    await addToCart(auth, { storeId: STORE_ID, productId: product.id, variantId: variant.id });

    const { body } = await placeOrder(auth, { storeId: STORE_ID });

    expect(body.data.order.items[0]).toMatchObject({ variantName: '5 kg', unitPricePaise: 25000 });
    expect(body.data.order.store).toMatchObject({ name: 'Sharma Kirana Store', phone: '+919812345601' });
  });

  it('snapshots the delivery address so a later deletion cannot rewrite it (7.7)', async () => {
    const auth = signIn();
    await readyCart(auth);
    const { body: address } = await createAddress(auth);

    const { body } = await placeOrder(auth, {
      storeId: STORE_ID,
      fulfilmentMode: 'delivery',
      addressId: address.data.address.id,
    });

    expect(body.data.order.fulfilment).toMatchObject({
      mode: 'delivery',
      deliveryFeePaise: 2900,
    });
    expect(body.data.order.fulfilment.address).toMatchObject({ line1: '221B Model Town' });
    expect(body.data.order.totalPaise).toBe(27900);

    await api().delete(url(`/addresses/${address.data.address.id}`)).set(auth);

    const after = await api().get(url(`/orders/${body.data.order.id}`)).set(auth);
    expect(after.body.data.order.fulfilment.address.line1).toBe('221B Model Town');
  });

  it('clears the cart only after the order is created (7.9)', async () => {
    const auth = signIn();
    await readyCart(auth);

    await placeOrder(auth, { storeId: STORE_ID });

    const { body } = await api().get(url(`/cart?storeId=${STORE_ID}`)).set(auth);
    expect(body.data.cart.lines).toEqual([]);
  });

  it('leaves the cart untouched when creation fails', async () => {
    const auth = signIn();
    const product = await readyCart(auth);
    // Sold out in the instant between the quote and the commit.
    product.stock = 0;
    product.is_available = false;

    const res = await placeOrder(auth, { storeId: STORE_ID });

    expect(res.status).toBe(422);
    const { body } = await api().get(url(`/cart?storeId=${STORE_ID}`)).set(auth);
    expect(body.data.cart.lines).toHaveLength(1);
  });

  it('decrements stock as part of the same transaction (7.6)', async () => {
    const auth = signIn();
    const product = await readyCart(auth, { stock: 10 });

    await placeOrder(auth, { storeId: STORE_ID });

    expect(db.tables.get('products')[0].stock).toBe(8);
  });

  it('rejects an order under the store minimum (6.9)', async () => {
    const auth = signIn();
    const product = seedProduct({ price_paise: 5000, stock: 10 });
    await addToCart(auth, { storeId: STORE_ID, productId: product.id });

    const res = await placeOrder(auth, { storeId: STORE_ID });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MINIMUM_ORDER_NOT_MET');
    expect(db.tables.get('orders') ?? []).toEqual([]);
  });

  it('rejects an empty cart', async () => {
    const auth = signIn();

    const res = await placeOrder(auth, { storeId: STORE_ID });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CART_EMPTY');
  });

  it('rejects a fulfilment mode the store does not offer (6.8)', async () => {
    const auth = signIn();
    await readyCart(auth);
    store.pickup_enabled = false;

    const res = await placeOrder(auth, { storeId: STORE_ID });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PICKUP_UNAVAILABLE');
  });

  it('rejects a delivery order with no address (6.8)', async () => {
    const auth = signIn();
    await readyCart(auth);

    const res = await placeOrder(auth, { storeId: STORE_ID, fulfilmentMode: 'delivery' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ADDRESS_REQUIRED');
  });

  it('refuses an item that went unavailable after the quote (7.16)', async () => {
    const auth = signIn();
    const product = await readyCart(auth);
    // Available at quote time, gone by commit time — only the database can
    // catch this, and it rolls the whole order back.
    supabaseAdmin.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: `ITEM_UNAVAILABLE:${product.name}` },
    });

    const res = await placeOrder(auth, { storeId: STORE_ID });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
    expect(res.body.error.message).toContain('Basmati Rice');
  });

  it('refuses when the total moved since the customer last saw it', async () => {
    const auth = signIn();
    const product = await readyCart(auth);
    product.price_paise = 20000;

    const res = await placeOrder(auth, { storeId: STORE_ID, expectedTotalPaise: 25000 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TOTAL_CHANGED');
    expect(res.body.error.details).toEqual({ expectedTotalPaise: 25000, totalPaise: 40000 });
  });

  it('accepts a total the customer has right', async () => {
    const auth = signIn();
    await readyCart(auth);

    const res = await placeOrder(auth, { storeId: STORE_ID, expectedTotalPaise: 25000 });

    expect(res.status).toBe(201);
  });

  it('surfaces an unexpected database failure as a 500 without leaking it', async () => {
    const auth = signIn();
    await readyCart(auth);
    supabaseAdmin.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42P01', message: 'relation "orders" does not exist' },
    });

    const res = await placeOrder(auth, { storeId: STORE_ID });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('does not exist');
  });

  it('rejects an unknown payment method', async () => {
    const auth = signIn();

    const res = await placeOrder(auth, { storeId: STORE_ID, paymentMethod: 'barter' });

    expect(res.status).toBe(422);
  });
});

describe('idempotency (7.5, D10)', () => {
  it('returns the original order for a replayed Idempotency-Key', async () => {
    const auth = signIn();
    await readyCart(auth);

    const first = await placeOrder(auth, { storeId: STORE_ID }, { idempotencyKey: 'key-001' });
    const second = await placeOrder(auth, { storeId: STORE_ID }, { idempotencyKey: 'key-001' });

    expect(first.status).toBe(201);
    expect(first.body.data.replayed).toBe(false);
    // A replay creates nothing, so it is a 200, not a 201.
    expect(second.status).toBe(200);
    expect(second.body.data.replayed).toBe(true);
    expect(second.body.data.order.id).toBe(first.body.data.order.id);
    expect(db.tables.get('orders')).toHaveLength(1);
  });

  it('does not decrement stock twice on a replay', async () => {
    const auth = signIn();
    await readyCart(auth, { stock: 10 });

    await placeOrder(auth, { storeId: STORE_ID }, { idempotencyKey: 'key-002' });
    await placeOrder(auth, { storeId: STORE_ID }, { idempotencyKey: 'key-002' });

    expect(db.tables.get('products')[0].stock).toBe(8);
  });

  it('lets a different key place a genuinely new order', async () => {
    const auth = signIn();
    await readyCart(auth, { stock: 50 });
    await placeOrder(auth, { storeId: STORE_ID }, { idempotencyKey: 'key-003' });

    await readyCart(auth, { slug: 'second-product', stock: 50 });
    const second = await placeOrder(auth, { storeId: STORE_ID }, { idempotencyKey: 'key-004' });

    expect(second.status).toBe(201);
    expect(db.tables.get('orders')).toHaveLength(2);
  });

  it("does not let one customer's key collide with another's", async () => {
    const auth = signIn();
    await readyCart(auth, { stock: 50 });
    const mine = await placeOrder(auth, { storeId: STORE_ID }, { idempotencyKey: 'shared-key' });

    const otherAuth = signIn(OTHER_CUSTOMER_ID);
    const product = seedProduct({ price_paise: 25000, stock: 10, slug: 'theirs' });
    await addToCart(otherAuth, { storeId: STORE_ID, productId: product.id });
    const theirs = await placeOrder(
      otherAuth,
      { storeId: STORE_ID },
      { idempotencyKey: 'shared-key' },
    );

    expect(theirs.status).toBe(201);
    expect(theirs.body.data.order.id).not.toBe(mine.body.data.order.id);
  });

  it('places two separate orders when no key is sent at all', async () => {
    const auth = signIn();
    await readyCart(auth, { stock: 50 });
    await placeOrder(auth, { storeId: STORE_ID });
    await readyCart(auth, { slug: 'again', stock: 50 });
    await placeOrder(auth, { storeId: STORE_ID });

    expect(db.tables.get('orders')).toHaveLength(2);
  });
});

describe('GET /api/v1/orders (8.1, 8.9)', () => {
  async function placeSome(auth, count) {
    const ids = [];
    for (let index = 0; index < count; index += 1) {
      await readyCart(auth, { slug: `product-${index}`, stock: 50 });
      const { body } = await placeOrder(auth, { storeId: STORE_ID });
      ids.push(body.data.order.id);
    }
    return ids;
  }

  it('lists the caller’s own orders, newest first', async () => {
    const auth = signIn();
    const ids = await placeSome(auth, 3);

    const res = await api().get(url('/orders')).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.orders.map((order) => order.id)).toEqual([...ids].reverse());
    expect(res.body.meta).toMatchObject({ page: 1, total: 3 });
  });

  it('never lists another customer’s orders (8.9)', async () => {
    const auth = signIn();
    await placeSome(auth, 1);

    const otherAuth = signIn(OTHER_CUSTOMER_ID);
    const res = await api().get(url('/orders')).set(otherAuth);

    expect(res.body.data.orders).toEqual([]);
  });

  it('filters by status', async () => {
    const auth = signIn();
    const [first] = await placeSome(auth, 2);
    await advance(auth, first, 'accepted');

    const { body } = await api().get(url('/orders?status=accepted')).set(auth);

    expect(body.data.orders).toHaveLength(1);
    expect(body.data.orders[0].id).toBe(first);
  });

  it('paginates and caps the page size', async () => {
    const auth = signIn();
    await placeSome(auth, 3);

    const { body } = await api().get(url('/orders?limit=2&page=2')).set(auth);

    expect(body.data.orders).toHaveLength(1);
    expect(body.meta).toMatchObject({ page: 2, limit: 2, total: 3, hasNextPage: false });

    const capped = await api().get(url('/orders?limit=500')).set(auth);
    expect(capped.status).toBe(422);
  });

  it('rejects an unknown status filter', async () => {
    const auth = signIn();

    const res = await api().get(url('/orders?status=teleported')).set(auth);

    expect(res.status).toBe(422);
  });

  it('carries enough for a history card without a second call', async () => {
    const auth = signIn();
    await placeSome(auth, 1);

    const { body } = await api().get(url('/orders')).set(auth);

    expect(body.data.orders[0]).toMatchObject({
      storeName: 'Sharma Kirana Store',
      statusLabel: 'Order placed',
      itemCount: 1,
      totalPaise: 25000,
      isCancellable: true,
    });
  });
});

describe('GET /api/v1/orders/:id (8.2, 8.5, 8.9)', () => {
  it('returns items, totals, payment, fulfilment and the timeline', async () => {
    const auth = signIn();
    await readyCart(auth);
    const { body: created } = await placeOrder(auth, { storeId: STORE_ID });

    const { body } = await api().get(url(`/orders/${created.data.order.id}`)).set(auth);
    const order = body.data.order;

    expect(order.items).toHaveLength(1);
    expect(order.totals).toMatchObject({
      subtotalPaise: 25000,
      deliveryFeePaise: 0,
      taxPaise: 0,
      totalPaise: 25000,
    });
    expect(order.fulfilment).toMatchObject({ mode: 'pickup' });
    expect(order.fulfilment.pickupFrom.name).toBe('Sharma Kirana Store');
    expect(order.timeline.history[0]).toMatchObject({ toStatus: 'placed', changedBy: 'customer' });
    expect(order.timeline.steps.map((step) => step.status)).toEqual([
      'placed',
      'accepted',
      'preparing',
      'ready_for_pickup',
      'completed',
    ]);
  });

  it('shows the delivery timeline for a delivery order (8.5)', async () => {
    const auth = signIn();
    await readyCart(auth);
    const { body: address } = await createAddress(auth);
    const { body: created } = await placeOrder(auth, {
      storeId: STORE_ID,
      fulfilmentMode: 'delivery',
      addressId: address.data.address.id,
    });

    const { body } = await api().get(url(`/orders/${created.data.order.id}`)).set(auth);

    const steps = body.data.order.timeline.steps.map((step) => step.status);
    expect(steps).toContain('out_for_delivery');
    expect(steps).not.toContain('ready_for_pickup');
  });

  it('marks the current step and stamps the ones already reached', async () => {
    const auth = signIn();
    await readyCart(auth);
    const { body: created } = await placeOrder(auth, { storeId: STORE_ID });
    await advance(auth, created.data.order.id, 'accepted');

    const { body } = await api().get(url(`/orders/${created.data.order.id}`)).set(auth);
    const steps = body.data.order.timeline.steps;

    expect(steps.find((step) => step.status === 'placed').reachedAt).toBeTruthy();
    expect(steps.find((step) => step.status === 'accepted').isCurrent).toBe(true);
    expect(steps.find((step) => step.status === 'completed').reachedAt).toBeNull();
  });

  it("404s for another customer's order, never 403 (8.9)", async () => {
    const auth = signIn();
    await readyCart(auth);
    const { body: created } = await placeOrder(auth, { storeId: STORE_ID });

    const otherAuth = signIn(OTHER_CUSTOMER_ID);
    const res = await api().get(url(`/orders/${created.data.order.id}`)).set(otherAuth);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('404s for an order that does not exist', async () => {
    const auth = signIn();

    const res = await api()
      .get(url('/orders/01111111-1111-4111-8111-000000009999'))
      .set(auth);

    expect(res.status).toBe(404);
  });
});
