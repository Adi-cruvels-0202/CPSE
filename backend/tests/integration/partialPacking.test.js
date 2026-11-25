/**
 * When the shop cannot pack everything (migration 0049), against real
 * Postgres: a line packed in part or not at all, the bill and stock holds
 * that follow, the prepaid difference refunded, the customer told and able to
 * cancel the rest, and the order called off when nothing at all is left.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', async () => {
  const { createPgSupabase } = await import('../helpers/pgSupabase.js');
  return createPgSupabase();
});

const { resetDatabase, sql } = await import('../helpers/pgSupabase.js');
const flow = await import('./flow.js');
const { call, expectStatus } = flow;

beforeEach(async () => {
  await resetDatabase();
});

const orderPath = (shop, orderId) => `/merchant/stores/${shop.store.id}/orders/${orderId}`;
const unavailable = (shop, orderId, itemId, body = {}) => call('post', `${orderPath(shop, orderId)}/items/${itemId}/unavailable`, shop.merchant, body);
const reserved = async (variantId) => (await sql('select reserved_quantity as r from product_variants where id = $1', [variantId]))[0].r;

/** 3 × rice 1 kg and 1 × dal, accepted, paid in cash (or online). */
async function orderWithTwoLines({ paymentMethod = 'cash' } = {}) {
  const shop = await flow.openShop();
  await flow.publish(shop);
  const rice = await flow.addRice(shop, { stock1kg: 20 });
  const dal = await flow.addSimpleProduct(shop, { name: 'Toor Dal', pricePaise: 15000, stock: 10 });
  const customer = await flow.newCustomer();
  await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 3);
  await flow.addToCart(customer, shop.store.id, dal.product.id, dal.variant.id, 1);
  const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id, paymentMethod }), 201);
  if (paymentMethod === 'online') await flow.payOnline(customer, order.id);
  expectStatus(await call('post', `${orderPath(shop, order.id)}/accept`, shop.merchant, {}), 200);
  const detail = expectStatus(await call('get', orderPath(shop, order.id), shop.merchant), 200).order;
  const line = (name) => detail.items.find((i) => i.productName === name);
  return { shop, customer, order: detail, rice, dal, riceLine: line('Basmati Rice'), dalLine: line('Toor Dal') };
}

describe('packing less than was ordered', () => {
  it('2 of 3 packed: the line, the bill and the stock hold follow, and the order carries on', async () => {
    const { shop, customer, order, rice, riceLine } = await orderWithTwoLines();
    expect(await reserved(rice.kg.id)).toBe(3);

    const { order: after } = expectStatus(await unavailable(shop, order.id, riceLine.id, { quantityLeft: 2 }), 200);
    const line = after.items.find((i) => i.id === riceLine.id);
    expect(line).toMatchObject({ quantity: 2, orderedQuantity: 3, unavailableQuantity: 1 });
    expect(after.status).toBe('accepted');
    // 1 kg rice is ₹120 + 5% tax: one fewer is ₹126 less.
    expect(after.totals.totalPaise).toBe(order.totals.totalPaise - 12600);
    expect(after.itemsChangedAt).toBeTruthy();
    expect(await reserved(rice.kg.id)).toBe(2);

    const [note] = await sql(`select title, body from notifications where customer_id = $1 and payload->>'event' = 'items_changed'`, [customer.id]);
    expect(note.title).toContain('Only 2 of 3 × Basmati Rice (1 kg) are available');
    expect(note.body).toContain('New total');
    expect(note.body).toContain('cancel');
  });

  it('none of a line: it moves to unavailableItems and the rest goes ahead', async () => {
    const { shop, customer, order, dal, dalLine } = await orderWithTwoLines();
    const { order: after } = expectStatus(await unavailable(shop, order.id, dalLine.id), 200);
    expect(after.items.map((i) => i.productName)).toEqual(['Basmati Rice']);
    expect(after.unavailableItems).toEqual([expect.objectContaining({ productName: 'Toor Dal', orderedQuantity: 1 })]);
    expect(after.totals.totalPaise).toBe(order.totals.totalPaise - 15000);
    expect(await reserved(dal.variant.id)).toBe(0);

    // The customer sees it too.
    const mine = expectStatus(await call('get', `/orders/${order.id}`, customer.auth), 200).order;
    expect(mine.unavailableItems).toEqual([expect.objectContaining({ name: 'Toor Dal', notAvailable: true })]);
    expect(mine.items).toHaveLength(1);
  });

  it('when nothing at all is left, the order is called off and the customer told why', async () => {
    const { shop, order, riceLine, dalLine } = await orderWithTwoLines();
    expectStatus(await unavailable(shop, order.id, dalLine.id), 200);
    const { order: after } = expectStatus(await unavailable(shop, order.id, riceLine.id, { quantityLeft: 0 }), 200);
    expect(after.status).toBe('cancelled');
    expect(after.cancellationReason).toContain('None of the items');
  });

  it('a placed order with nothing left is rejected instead', async () => {
    const shop = await flow.openShop();
    await flow.publish(shop);
    const rice = await flow.addRice(shop);
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    const detail = expectStatus(await call('get', orderPath(shop, order.id), shop.merchant), 200).order;
    const { order: after } = expectStatus(await unavailable(shop, order.id, detail.items[0].id), 200);
    expect(after.status).toBe('rejected');
  });
});

describe('the rules', () => {
  it('only before the order is ready', async () => {
    const { shop, order, riceLine } = await orderWithTwoLines();
    expectStatus(await call('post', `${orderPath(shop, order.id)}/status`, shop.merchant, { status: 'preparing' }), 200);
    expectStatus(await call('post', `${orderPath(shop, order.id)}/status`, shop.merchant, { status: 'ready_for_pickup' }), 200);
    const res = await unavailable(shop, order.id, riceLine.id, { quantityLeft: 1 });
    expect(res.status).toBe(409);
  });

  it('the quantity left must be less than ordered', async () => {
    const { shop, order, riceLine } = await orderWithTwoLines();
    const res = await unavailable(shop, order.id, riceLine.id, { quantityLeft: 3 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BAD_QUANTITY');
  });

  it("another shop's order is a 404", async () => {
    const { order, riceLine } = await orderWithTwoLines();
    const other = await flow.openShop({ name: 'Other Shop' });
    expect((await unavailable(other, order.id, riceLine.id)).status).toBe(404);
  });
});

describe('money', () => {
  it('a prepaid order gets the difference back at once', async () => {
    const { shop, order, dalLine } = await orderWithTwoLines({ paymentMethod: 'online' });
    expectStatus(await unavailable(shop, order.id, dalLine.id), 200);
    const refunds = await sql(`select kind, amount_paise, reason, initiated_by from refunds where order_id = $1`, [order.id]);
    expect(refunds).toEqual([{ kind: 'adjustment', amount_paise: 15000, reason: 'Item not available', initiated_by: 'store' }]);
  });

  it('the customer may still cancel the changed order while it is prepared, and only the rest is refunded', async () => {
    const { shop, customer, order, dalLine } = await orderWithTwoLines({ paymentMethod: 'online' });
    expectStatus(await call('post', `${orderPath(shop, order.id)}/status`, shop.merchant, { status: 'preparing' }), 200);
    expectStatus(await unavailable(shop, order.id, dalLine.id), 200);

    const mine = expectStatus(await call('get', `/orders/${order.id}`, customer.auth), 200).order;
    expect(mine.isCancellable).toBe(true);
    expectStatus(await call('post', `/orders/${order.id}/cancel`, customer.auth, { reason: 'Need the dal too' }), 200);

    const refunds = await sql(`select kind, amount_paise from refunds where order_id = $1 order by created_at`, [order.id]);
    expect(refunds.map((r) => r.kind)).toEqual(['adjustment', 'cancellation']);
    expect(refunds[0].amount_paise + refunds[1].amount_paise).toBe(order.totals.totalPaise);
  });

  it('an unchanged order being prepared still cannot be cancelled by the customer', async () => {
    const { shop, customer, order } = await orderWithTwoLines();
    expectStatus(await call('post', `${orderPath(shop, order.id)}/status`, shop.merchant, { status: 'preparing' }), 200);
    expect((await call('post', `/orders/${order.id}/cancel`, customer.auth, {})).status).toBe(409);
  });
});
