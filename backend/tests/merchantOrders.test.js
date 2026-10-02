import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';
import { ALWAYS_OPEN, addToCart, createAddress, placeOrder } from './helpers/shopping.js';

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
  seedMerchant,
  seedStore,
  seedCategory,
  seedProduct,
  defaultVariantOf,
} = await import('./helpers/supabaseMock.js');

/**
 * A merchant's orders — MERCHANT_API.md, Orders; MERCHANT_RULES §6.
 *
 * Two people: SHOPPER places orders, and the signed-in MERCHANT owns the store.
 */

const MERCHANT_ID = '81111111-1111-4111-8111-000000000001';
const SHOPPER_ID = CUSTOMER_ID;
const OTHER_MERCHANT_ID = '81111111-1111-4111-8111-000000000099';
const OTHER_STORE_ID = '41111111-1111-4111-8111-0000000000b2';

let rice;

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  seedCustomer({ id: SHOPPER_ID, full_name: 'Jane Doe', phone: '+919812345678' });
  seedCustomer({ id: MERCHANT_ID, email: 'owner@shop.in' });
  seedMerchant({ id: MERCHANT_ID, email: 'owner@shop.in' });
  seedCustomer({ id: OTHER_MERCHANT_ID, email: 'other@shop.in' });
  seedMerchant({ id: OTHER_MERCHANT_ID, email: 'other@shop.in' });
  seedStore({ owner_id: MERCHANT_ID, opening_hours: ALWAYS_OPEN });
  seedStore({ id: OTHER_STORE_ID, slug: 'other-shop', owner_id: OTHER_MERCHANT_ID, opening_hours: ALWAYS_OPEN });
  seedCategory();
  rice = seedProduct({ name: 'Basmati Rice', price_paise: 12900, tax_percent: 5, stock: 10 });
});

const as = (id) => {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  return { Authorization: 'Bearer token-abc' };
};

/** SHOPPER orders `quantity` of rice; answers with the customer's view of it. */
async function shopperOrder({ quantity = 2, fulfilmentMode = 'pickup', note } = {}) {
  const auth = as(SHOPPER_ID);
  await addToCart(auth, { storeId: STORE_ID, productId: rice.id, quantity });
  const address = fulfilmentMode === 'delivery' ? (await createAddress(auth)).body.data.address.id : undefined;
  const { body } = await placeOrder(auth, { storeId: STORE_ID, fulfilmentMode, addressId: address, customerNote: note });
  return body.data.order;
}

const ordersUrl = (path = '', storeId = STORE_ID) => url(`/merchant/stores/${storeId}/orders${path}`);
const act = (orderId, action, body = {}, storeId = STORE_ID) =>
  api().post(ordersUrl(`/${orderId}/${action}`, storeId)).set(as(MERCHANT_ID)).send(body);
const stock = () => {
  const variant = defaultVariantOf(rice);
  return { onHand: variant.quantity_on_hand, reserved: variant.reserved_quantity };
};

describe('GET …/orders/:orderId', () => {
  it('shows the merchant everything needed to fulfil it, and what can be done next', async () => {
    const order = await shopperOrder({ note: 'Ring the bell twice' });

    const { status, body } = await api().get(ordersUrl(`/${order.id}`)).set(as(MERCHANT_ID));

    expect(status).toBe(200);
    expect(body.data.order).toMatchObject({
      id: order.id,
      orderNumber: order.orderNumber,
      status: 'placed',
      paymentMethod: 'cash',
      fulfilmentMode: 'pickup',
      allowedActions: ['accept', 'reject'],
      customer: { id: SHOPPER_ID, name: 'Jane Doe', phone: '+919812345678' },
      customerNote: 'Ring the bell twice',
      totals: { subtotalPaise: 25800, taxPaise: 1290, totalPaise: 27090 },
      itemCount: 1,
      history: [{ status: 'placed', changedBy: 'customer' }],
    });
    expect(body.data.order.items[0]).toMatchObject({
      productName: 'Basmati Rice',
      quantity: 2,
      lineSubtotalPaise: 25800,
      taxPercent: 5,
      taxPaise: 1290,
      lineTotalPaise: 27090,
    });
  });

  it('is 404 for an order of another store, even through the merchant’s own store path', async () => {
    const order = await shopperOrder();

    const viaOwn = await api().get(ordersUrl(`/${order.id}`, OTHER_STORE_ID)).set(as(OTHER_MERCHANT_ID));
    const viaTheirs = await api().get(ordersUrl(`/${order.id}`)).set(as(OTHER_MERCHANT_ID));

    expect(viaOwn.status).toBe(404);
    expect(viaTheirs.status).toBe(404);
  });
});

describe('the pickup lifecycle', () => {
  it('walks accept → preparing → ready → complete, notifying the customer and moving stock', async () => {
    const order = await shopperOrder();
    expect(stock()).toEqual({ onHand: 10, reserved: 2 });

    const accepted = await act(order.id, 'accept');
    expect(accepted.body.data.order).toMatchObject({ status: 'accepted', allowedActions: ['status:preparing', 'reject', 'cancel'] });
    expect(accepted.body.data.order.acceptedAt).toBeTruthy();

    const preparing = await act(order.id, 'status', { status: 'preparing' });
    expect(preparing.body.data.order.allowedActions).toEqual(['status:ready_for_pickup', 'cancel']);

    const ready = await act(order.id, 'status', { status: 'ready_for_pickup' });
    expect(ready.body.data.order.allowedActions).toEqual(['complete', 'cancel']);
    expect(stock()).toEqual({ onHand: 10, reserved: 2 });

    const done = await act(order.id, 'complete');
    expect(done.body.data.order).toMatchObject({ status: 'completed', allowedActions: [] });
    expect(stock()).toEqual({ onHand: 8, reserved: 0 });

    const history = done.body.data.order.history.map((entry) => [entry.status, entry.changedBy]);
    expect(history).toEqual([
      ['placed', 'customer'],
      ['accepted', 'store'],
      ['preparing', 'store'],
      ['ready_for_pickup', 'store'],
      ['completed', 'store'],
    ]);

    const notified = (db.tables.get('notifications') ?? []).filter((row) => row.type === 'order_status_changed');
    expect(notified).toHaveLength(4);

    // The customer sees the same order, completed.
    const mine = await api().get(url(`/orders/${order.id}`)).set(as(SHOPPER_ID));
    expect(mine.body.data.order.status).toBe('completed');
  });

  it('cannot send a pickup order out for delivery', async () => {
    const order = await shopperOrder();
    await act(order.id, 'accept');
    await act(order.id, 'status', { status: 'preparing' });

    const res = await act(order.id, 'status', { status: 'out_for_delivery' });

    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ status: 'preparing', action: 'status:out_for_delivery' });
  });
});

describe('the delivery lifecycle', () => {
  it('goes out for delivery, and cannot be marked ready for pickup', async () => {
    const order = await shopperOrder({ fulfilmentMode: 'delivery' });
    await act(order.id, 'accept');
    const preparing = await act(order.id, 'status', { status: 'preparing' });
    expect(preparing.body.data.order.allowedActions).toEqual(['status:out_for_delivery', 'cancel']);

    expect((await act(order.id, 'status', { status: 'ready_for_pickup' })).status).toBe(409);
    expect((await act(order.id, 'status', { status: 'out_for_delivery' })).status).toBe(200);

    const detail = await api().get(ordersUrl(`/${order.id}`)).set(as(MERCHANT_ID));
    expect(detail.body.data.order.deliveryAddress).toMatchObject({ line1: '221B Model Town' });
  });
});

describe('rejecting and cancelling', () => {
  it('rejects a placed order with a reason, gives the stock back and tells the customer why', async () => {
    const order = await shopperOrder();

    const res = await act(order.id, 'reject', { reason: 'Out of rice' });

    expect(res.body.data.order).toMatchObject({ status: 'rejected', cancellationReason: 'Out of rice', allowedActions: [] });
    expect(stock()).toEqual({ onHand: 10, reserved: 0 });
    const mine = await api().get(url(`/orders/${order.id}`)).set(as(SHOPPER_ID));
    expect(mine.body.data.order.cancellationReason).toBe('Out of rice');
  });

  it('can reject an accepted order too, but not one being prepared', async () => {
    const first = await shopperOrder({ quantity: 2 });
    await act(first.id, 'accept');
    expect((await act(first.id, 'reject')).status).toBe(200);

    const second = await shopperOrder({ quantity: 2 });
    await act(second.id, 'accept');
    await act(second.id, 'status', { status: 'preparing' });
    expect((await act(second.id, 'reject')).status).toBe(409);
  });

  it('cancels from accepted onwards, with a reason, and gives the stock back', async () => {
    const order = await shopperOrder();
    await act(order.id, 'accept');
    await act(order.id, 'status', { status: 'preparing' });

    const res = await act(order.id, 'cancel', { reason: 'Power cut, closing early' });

    expect(res.body.data.order).toMatchObject({ status: 'cancelled', cancellationReason: 'Power cut, closing early' });
    expect(stock()).toEqual({ onHand: 10, reserved: 0 });
  });

  it('will not cancel a placed order — that is a rejection (O-1)', async () => {
    const order = await shopperOrder();

    const res = await act(order.id, 'cancel', { reason: 'No thanks' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/reject it instead/i);
  });

  it('needs a real reason to cancel (O-8)', async () => {
    const order = await shopperOrder();
    await act(order.id, 'accept');
    expect((await act(order.id, 'cancel', {})).status).toBe(422);
    expect((await act(order.id, 'cancel', { reason: 'no' })).status).toBe(422);
  });
});

describe('what the merchant cannot do', () => {
  it('cannot skip a step, or move a finished order', async () => {
    const order = await shopperOrder();
    expect((await act(order.id, 'complete')).status).toBe(409);

    await act(order.id, 'reject');
    expect((await act(order.id, 'accept')).status).toBe(409);
  });

  it('cannot touch an order still waiting for online payment (O-9)', async () => {
    const auth = as(SHOPPER_ID);
    await addToCart(auth, { storeId: STORE_ID, productId: rice.id, quantity: 2 });
    const { body } = await placeOrder(auth, { storeId: STORE_ID, paymentMethod: 'online' });
    const order = body.data.order;

    const detail = await api().get(ordersUrl(`/${order.id}`)).set(as(MERCHANT_ID));
    expect(detail.body.data.order).toMatchObject({ paymentMethod: 'online', allowedActions: [] });

    for (const action of ['accept', 'reject']) {
      const res = await act(order.id, action);
      expect(res.status, action).toBe(409);
      expect(res.body.error.message).toMatch(/waiting for the customer to pay/);
    }
  });

  it('cannot act on another store’s order', async () => {
    const order = await shopperOrder();
    const res = await api()
      .post(ordersUrl(`/${order.id}/accept`, OTHER_STORE_ID))
      .set(as(OTHER_MERCHANT_ID))
      .send({});
    expect(res.status).toBe(404);
    expect(db.tables.get('orders')[0].status).toBe('placed');
  });

  it('refuses a status that is not a step in between', async () => {
    const order = await shopperOrder();
    await act(order.id, 'accept');
    for (const status of ['completed', 'cancelled', 'shipped']) {
      expect((await act(order.id, 'status', { status })).status, status).toBe(422);
    }
  });
});

describe('GET …/orders', () => {
  let clock = Date.parse('2026-10-03T09:00:00Z');
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());
  const tick = () => vi.setSystemTime((clock += 1000));

  it('lists newest first with tab counts, leaving unpaid online orders out', async () => {
    tick();
    const first = await shopperOrder({ quantity: 2 });
    tick();
    const second = await shopperOrder({ quantity: 2 });
    tick();
    await act(second.id, 'accept');
    const auth = as(SHOPPER_ID);
    await addToCart(auth, { storeId: STORE_ID, productId: rice.id, quantity: 2 });
    tick();
    const unpaid = (await placeOrder(auth, { storeId: STORE_ID, paymentMethod: 'online' })).body.data.order;

    const { body } = await api().get(ordersUrl()).set(as(MERCHANT_ID));

    expect(body.data.orders.map((order) => order.id)).toEqual([second.id, first.id]);
    expect(body.data.orders[0]).toMatchObject({ itemCount: 1, status: 'accepted' });
    expect(body.data.orders[0]).not.toHaveProperty('items');
    expect(body.data.counts).toMatchObject({ placed: 1, accepted: 1, pending_payment: 1, completed: 0 });
    expect(body.meta).toMatchObject({ total: 2 });

    const asked = await api().get(ordersUrl('?status=pending_payment')).set(as(MERCHANT_ID));
    expect(asked.body.data.orders.map((order) => order.id)).toEqual([unpaid.id]);
  });

  it('filters by a list of statuses and by fulfilment mode', async () => {
    tick();
    const pickup = await shopperOrder({ quantity: 2 });
    tick();
    const delivery = await shopperOrder({ quantity: 2, fulfilmentMode: 'delivery' });
    tick();
    await act(delivery.id, 'accept');

    const ids = async (query) => (await api().get(ordersUrl(query)).set(as(MERCHANT_ID))).body.data.orders.map((o) => o.id);

    expect(await ids('?status=placed,accepted')).toEqual([delivery.id, pickup.id]);
    expect(await ids('?status=accepted')).toEqual([delivery.id]);
    expect(await ids('?fulfilmentMode=pickup')).toEqual([pickup.id]);
    expect((await api().get(ordersUrl('?status=placed,shipped')).set(as(MERCHANT_ID))).status).toBe(422);
  });

  it('shows no other store’s orders', async () => {
    await shopperOrder();
    const { body } = await api().get(ordersUrl('', OTHER_STORE_ID)).set(as(OTHER_MERCHANT_ID));
    expect(body.data.orders).toEqual([]);
  });
});
