/**
 * The core shared commerce flow, end to end against real Postgres:
 * merchant publishes → customer finds it → multi-weight cart → checkout →
 * order → merchant fulfils → ledger, history and receipt agree.
 * Roadmap §5 Customer Commerce Foundation, §6 Shared Commerce Flows 1–5.
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

describe('store publishing (shared flow 1)', () => {
  it('an unpublished store is invisible to customers and appears once published', async () => {
    const shop = await flow.openShop();
    expect((await call('get', `/stores/${shop.store.slug}`)).status).toBe(404);

    await flow.publish(shop);
    const { store } = expectStatus(await call('get', `/stores/${shop.store.slug}`), 200);
    expect(store.id).toBe(shop.store.id);
    expect(store.name).toBe('Sharma Kirana');
  });
});

describe('multi-weight cart (roadmap: 1 kg + 500 g of the same item)', () => {
  it('keeps 1 kg and 500 g as separate lines with their own SKU, price and stock through to the order', async () => {
    const shop = await flow.openShop();
    await flow.publish(shop);
    const rice = await flow.addRice(shop, { stock1kg: 3, stock500g: 5 });
    const customer = await flow.newCustomer();

    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { cart } = await flow.addToCart(customer, shop.store.id, rice.product.id, rice.halfKg.id, 2);

    expect(cart.lines).toHaveLength(2);
    const lineFor = (variantId) => cart.lines.find((line) => line.variantId === variantId);
    expect(lineFor(rice.kg.id)).toMatchObject({ quantity: 1, unitPricePaise: 12000 });
    expect(lineFor(rice.halfKg.id)).toMatchObject({ quantity: 2, unitPricePaise: 6500 });

    // Adding the same weight again bumps that line only.
    const again = await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    expect(again.cart.lines).toHaveLength(2);
    expect(again.cart.lines.find((line) => line.variantId === rice.kg.id).quantity).toBe(2);

    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    expect(order.items).toHaveLength(2);
    const kgItem = order.items.find((item) => item.variantId === rice.kg.id);
    const halfItem = order.items.find((item) => item.variantId === rice.halfKg.id);
    expect(kgItem).toMatchObject({ sku: 'RICE-1KG', quantity: 2, unitPricePaise: 12000, taxPaise: 1200 });
    expect(halfItem).toMatchObject({ sku: 'RICE-500G', quantity: 2, unitPricePaise: 6500, taxPaise: 650 });
    expect(order.totals).toMatchObject({ subtotalPaise: 37000, taxPaise: 1850, totalPaise: 38850 });

    // Each SKU reserved its own stock.
    const variants = await sql(
      'select sku, quantity_on_hand, reserved_quantity from product_variants where product_id = $1 order by sku',
      [rice.product.id],
    );
    expect(variants).toEqual([
      { sku: 'RICE-1KG', quantity_on_hand: 3, reserved_quantity: 2 },
      { sku: 'RICE-500G', quantity_on_hand: 5, reserved_quantity: 2 },
    ]);
  });

  it('refuses more of one weight than is available without touching the other weight', async () => {
    const shop = await flow.openShop();
    await flow.publish(shop);
    const rice = await flow.addRice(shop, { stock1kg: 1, stock500g: 5 });
    const customer = await flow.newCustomer();

    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.halfKg.id, 3);
    const tooMany = await call('post', '/cart/items', customer.auth, {
      storeId: shop.store.id,
      productId: rice.product.id,
      variantId: rice.kg.id,
      quantity: 2,
    });
    expect(tooMany.status).toBe(422);

    const { cart } = expectStatus(await call('get', `/cart?storeId=${shop.store.id}`, customer.auth), 200);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ variantId: rice.halfKg.id, quantity: 3 });
  });
});

describe('order and sale flows (shared flows 4 and 5)', () => {
  it('records the stock movement exactly once when the order completes, and the customer sees each status', async () => {
    const shop = await flow.openShop();
    await flow.publish(shop);
    const rice = await flow.addRice(shop, { stock1kg: 10 });
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 4);

    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    await flow.fulfil(shop, order.id);

    const detail = expectStatus(await call('get', `/orders/${order.id}`, customer.auth), 200).order;
    expect(detail.status).toBe('completed');
    expect(detail.timeline.history.map((entry) => entry.toStatus)).toEqual([
      'placed',
      'accepted',
      'preparing',
      'ready_for_pickup',
      'completed',
    ]);

    const ledger = await sql(
      `select movement_type, on_hand_change, reserved_change from inventory_ledger
        where variant_id = $1 order by created_at`,
      [rice.kg.id],
    );
    expect(ledger).toEqual([
      { movement_type: 'stock_in', on_hand_change: 10, reserved_change: 0 },
      { movement_type: 'order_reserved', on_hand_change: 0, reserved_change: 4 },
      { movement_type: 'order_fulfilled', on_hand_change: -4, reserved_change: -4 },
    ]);
    const [variant] = await sql('select quantity_on_hand, reserved_quantity from product_variants where id = $1', [rice.kg.id]);
    expect(variant).toEqual({ quantity_on_hand: 6, reserved_quantity: 0 });

    const notifications = await sql('select type from notifications where customer_id = $1 order by created_at', [customer.id]);
    expect(notifications.length).toBeGreaterThanOrEqual(5);
  });

  it('a duplicate checkout with the same Idempotency-Key creates one order and reserves stock once', async () => {
    const shop = await flow.openShop();
    await flow.publish(shop);
    const rice = await flow.addRice(shop, { stock1kg: 10 });
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 2);

    const first = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }, { idempotencyKey: 'same-key' }), 201);
    const second = await flow.placeOrder(customer, { storeId: shop.store.id }, { idempotencyKey: 'same-key' });
    expect([200, 201]).toContain(second.status);
    expect(second.body.data.order.id).toBe(first.order.id);
    expect(second.body.data.replayed).toBe(true);

    expect(await sql('select count(*)::int as n from orders')).toEqual([{ n: 1 }]);
    const [variant] = await sql('select reserved_quantity from product_variants where id = $1', [rice.kg.id]);
    expect(variant.reserved_quantity).toBe(2);
  });

  it('two customers cannot both buy the last unit', async () => {
    const shop = await flow.openShop();
    await flow.publish(shop);
    const { product, variant } = await flow.addSimpleProduct(shop, { stock: 1 });
    const first = await flow.newCustomer('First');
    const second = await flow.newCustomer('Second');
    await flow.addToCart(first, shop.store.id, product.id, variant.id, 1);
    await flow.addToCart(second, shop.store.id, product.id, variant.id, 1);

    const results = await Promise.all([
      flow.placeOrder(first, { storeId: shop.store.id }),
      flow.placeOrder(second, { storeId: shop.store.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(await sql('select count(*)::int as n from orders')).toEqual([{ n: 1 }]);
  });
});

describe('tenant isolation', () => {
  it("a merchant cannot read or act on another merchant's store, products or orders", async () => {
    const shopA = await flow.openShop({ name: 'Shop A' });
    const shopB = await flow.openShop({ name: 'Shop B' });
    await flow.publish(shopA);
    const { product, variant } = await flow.addSimpleProduct(shopA);
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shopA.store.id, product.id, variant.id, 1);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shopA.store.id }), 201);

    expect((await call('get', `/merchant/stores/${shopA.store.id}`, shopB.merchant)).status).toBe(404);
    expect((await call('get', `/merchant/stores/${shopA.store.id}/orders/${order.id}`, shopB.merchant)).status).toBe(404);
    expect((await call('post', `/merchant/stores/${shopA.store.id}/orders/${order.id}/accept`, shopB.merchant, {})).status).toBe(404);
    expect((await call('get', `/merchant/stores/${shopB.store.id}/orders/${order.id}`, shopB.merchant)).status).toBe(404);
    expect(
      (await call('post', `/merchant/stores/${shopA.store.id}/inventory/stock-in`, shopB.merchant, { variantId: variant.id, quantity: 5 })).status,
    ).toBe(404);
    expect(
      (await call('post', `/merchant/stores/${shopB.store.id}/inventory/stock-in`, shopB.merchant, { variantId: variant.id, quantity: 5 })).status,
    ).toBe(404);
  });

  it("a customer cannot read another customer's order, receipt or cart line", async () => {
    const shop = await flow.openShop();
    await flow.publish(shop);
    const { product, variant } = await flow.addSimpleProduct(shop);
    const owner = await flow.newCustomer('Owner');
    const other = await flow.newCustomer('Other');
    const { cart } = await flow.addToCart(owner, shop.store.id, product.id, variant.id, 1);
    const lineId = cart.lines[0].id;
    const { order } = expectStatus(await flow.placeOrder(owner, { storeId: shop.store.id }), 201);

    expect((await call('get', `/orders/${order.id}`, other.auth)).status).toBe(404);
    expect((await call('get', `/orders/${order.id}/receipt`, other.auth)).status).toBe(404);
    expect((await call('post', `/orders/${order.id}/cancel`, other.auth, {})).status).toBe(404);
    expect((await call('patch', `/cart/items/${lineId}`, other.auth, { quantity: 3 })).status).toBe(404);
  });

  it('refuses unauthenticated and forged tokens', async () => {
    expect((await call('get', '/orders')).status).toBe(401);
    expect((await call('get', '/orders', { Authorization: 'Bearer user:00000000-0000-4000-8000-000000000000' })).status).toBe(401);
    expect((await call('get', '/merchant/stores', { Authorization: 'Bearer nonsense' })).status).toBe(401);
  });
});
