/**
 * Merchant CRM and customer effort reduction against real Postgres
 * (migration 0041). Roadmap §4 P2 (CRM, status, value, favourites,
 * communication preferences), §5 P2 (favourites, lists, templates, buy again,
 * smart cart, quick checkout, saved preferences), P3 (communication
 * preferences), P6 (events and deterministic metrics); §6 Customer
 * relationship flow.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', async () => {
  const { createPgSupabase } = await import('../helpers/pgSupabase.js');
  return createPgSupabase();
});

const { resetDatabase, sql } = await import('../helpers/pgSupabase.js');
const { segmentFor } = await import('../../src/lib/customerSegments.js');
const flow = await import('./flow.js');
const { call, expectStatus } = flow;

beforeEach(async () => {
  await resetDatabase();
});

const base = (shop) => `/merchant/stores/${shop.store.id}`;

async function shopWithGoods() {
  const shop = await flow.openShop();
  await flow.publish(shop);
  const rice = await flow.addRice(shop, { stock1kg: 100, stock500g: 100, taxPercent: 0 });
  const dal = await flow.addSimpleProduct(shop, { name: 'Toor Dal', pricePaise: 15000, stock: 100 });
  const oil = await flow.addSimpleProduct(shop, { name: 'Mustard Oil', pricePaise: 18000, stock: 100 });
  return { shop, rice, dal, oil };
}

async function buy(customer, shop, lines) {
  for (const [productId, variantId, qty] of lines) await flow.addToCart(customer, shop.store.id, productId, variantId, qty);
  const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
  await flow.fulfil(shop, order.id);
  return order;
}

describe('merchant CRM', () => {
  it('builds each customer’s record from this store’s transactions only', async () => {
    const { shop, rice, dal } = await shopWithGoods();
    const other = await flow.openShop({ name: 'Other Shop' });
    await flow.publish(other);
    const elsewhere = await flow.addSimpleProduct(other, { name: 'Soap', pricePaise: 4000 });

    const customer = await flow.newCustomer('Meena');
    await buy(customer, shop, [[rice.product.id, rice.kg.id, 1], [dal.product.id, dal.variant.id, 1]]);
    await buy(customer, shop, [[rice.product.id, rice.kg.id, 2]]);
    await buy(customer, other, [[elsewhere.product.id, elsewhere.variant.id, 1]]);

    const list = expectStatus(await call('get', `${base(shop)}/customers`, shop.merchant), 200);
    expect(list.customers).toHaveLength(1);
    expect(list.customers[0]).toMatchObject({ name: 'Meena', orderCount: 2, totalSpendPaise: 27000 + 24000, segment: 'active' });
    expect(list.segments.active).toBe(1);

    const detail = expectStatus(await call('get', `${base(shop)}/customers/${customer.id}`, shop.merchant), 200).customer;
    expect(detail.purchaseHistory).toHaveLength(2);
    expect(detail.favouriteProducts.repeatPurchases).toEqual([{ productId: rice.product.id, name: 'Basmati Rice', orderCount: 2, units: 3 }]);
    expect(detail.firstOrderAt).toBeTruthy();
    expect(detail.consent).toMatchObject({ promotions: false, reminders: true });

    // The other shop sees only its own sale.
    const theirs = expectStatus(await call('get', `${base(other)}/customers/${customer.id}`, other.merchant), 200).customer;
    expect(theirs).toMatchObject({ orderCount: 1, totalSpendPaise: 4000 });
  });

  it('keeps notes per store, and a customer who never dealt with the store is not found', async () => {
    const { shop, rice } = await shopWithGoods();
    const customer = await flow.newCustomer();
    expect((await call('get', `${base(shop)}/customers/${customer.id}`, shop.merchant)).status).toBe(404);
    await buy(customer, shop, [[rice.product.id, rice.kg.id, 1]]);
    const saved = expectStatus(
      await call('patch', `${base(shop)}/customers/${customer.id}`, shop.merchant, { notes: 'Prefers morning pickup', tags: ['regular', 'regular', 'bulk'] }),
      200,
    ).customer;
    expect(saved).toMatchObject({ notes: 'Prefers morning pickup', tags: ['regular', 'bulk'] });

    const other = await flow.openShop({ name: 'Other' });
    expect((await call('get', `${base(other)}/customers/${customer.id}`, other.merchant)).status).toBe(404);
    expect((await call('get', `${base(shop)}/customers/${customer.id}`, other.merchant)).status).toBe(404);
  });

  it('shows the customer’s communication consent as the customer set it', async () => {
    const { shop, rice } = await shopWithGoods();
    const customer = await flow.newCustomer();
    await buy(customer, shop, [[rice.product.id, rice.kg.id, 1]]);
    expectStatus(await call('put', `/stores/${shop.store.id}/preferences`, customer.auth, { allowPromotions: true, allowWhatsapp: true }), 200);
    const detail = expectStatus(await call('get', `${base(shop)}/customers/${customer.id}`, shop.merchant), 200).customer;
    expect(detail.consent).toMatchObject({ promotions: true, whatsapp: true, sms: false });
  });

  it('segments deterministically', () => {
    const now = new Date('2026-06-30T00:00:00Z');
    const days = (n) => new Date(now.getTime() - n * 86_400_000).toISOString();
    expect(segmentFor([], now)).toBe('prospect');
    expect(segmentFor([days(5)], now)).toBe('new');
    expect(segmentFor([days(40), days(5)], now)).toBe('active');
    expect(segmentFor([days(150), days(120), days(90), days(30), days(2)], now)).toBe('loyal');
    expect(segmentFor([days(200), days(100)], now)).toBe('inactive');
  });
});

describe('customer effort reduction', () => {
  it('saves preferences (no payment credentials) and quick checkout uses them, ready to confirm', async () => {
    const { shop, rice } = await shopWithGoods();
    const customer = await flow.newCustomer();
    await flow.addAddress(customer);
    const prefs = expectStatus(
      await call('patch', '/me/preferences', customer.auth, { preferredFulfilment: 'delivery', preferredPaymentMethod: 'online', preferredSubstitution: 'allow_similar' }),
      200,
    ).preferences;
    expect(prefs).toMatchObject({ preferredFulfilment: 'delivery', preferredPaymentMethod: 'online' });
    expect((await call('patch', '/me/preferences', customer.auth, { cardNumber: '4111111111111111' })).status).toBe(422);

    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const quick = expectStatus(await call('post', '/checkout/quick', customer.auth, { storeId: shop.store.id }), 200);
    expect(quick.settings).toMatchObject({ fulfilmentMode: 'delivery', paymentMethod: 'online', substitutionPreference: 'allow_similar' });
    expect(quick.settings.addressId).toBeTruthy();
    expect(quick.quote.canPlaceOrder).toBe(true);

    const { order } = expectStatus(
      await flow.placeOrder(customer, { storeId: shop.store.id, fulfilmentMode: 'delivery', addressId: quick.settings.addressId, paymentMethod: 'online', expectedTotalPaise: quick.quote.totals.totalPaise }),
      201,
    );
    expect(order.substitutionPreference).toBe('allow_similar');
  });

  it('favourites, recently viewed (only with tracking on), buy again and the smart cart', async () => {
    const { shop, rice, dal, oil } = await shopWithGoods();
    const customer = await flow.newCustomer();

    expectStatus(await call('post', `/me/favourites/${oil.product.id}`, customer.auth, {}), 200);
    expectStatus(await call('post', `/me/favourites/${oil.product.id}`, customer.auth, {}), 200);
    expect(expectStatus(await call('get', '/me/favourites', customer.auth), 200).products.map((p) => p.id)).toEqual([oil.product.id]);

    expectStatus(await call('post', '/me/events', customer.auth, { eventType: 'product_view', productId: dal.product.id }), 200);
    expect(expectStatus(await call('get', '/me/recently-viewed', customer.auth), 200).products.map((p) => p.id)).toEqual([dal.product.id]);
    expectStatus(await call('patch', '/me/preferences', customer.auth, { activityTracking: false }), 200);
    expect((await call('post', '/me/events', customer.auth, { eventType: 'product_view', productId: rice.product.id })).body.data).toEqual({ recorded: false, reason: 'TRACKING_OFF' });
    expect(expectStatus(await call('get', '/me/recently-viewed', customer.auth), 200).products).toEqual([]);

    await buy(customer, shop, [[rice.product.id, rice.kg.id, 2], [dal.product.id, dal.variant.id, 1]]);
    await buy(customer, shop, [[rice.product.id, rice.kg.id, 2], [oil.product.id, oil.variant.id, 1]]);
    await buy(customer, shop, [[rice.product.id, rice.kg.id, 3], [dal.product.id, dal.variant.id, 1]]);

    const again = expectStatus(await call('get', `/me/buy-again?storeId=${shop.store.id}`, customer.auth), 200).products;
    expect(again[0]).toMatchObject({ id: rice.product.id, timesBought: 3, usualQuantity: 2, usualVariantId: rice.kg.id });

    const smart = expectStatus(await call('get', `/me/smart-cart?storeId=${shop.store.id}`, customer.auth), 200).smartCart;
    expect(smart.basedOnOrders).toBe(3);
    expect(smart.usual.map((p) => p.name).sort()).toEqual(['Basmati Rice', 'Toor Dal']);
    expect(smart.missingFromCart).toHaveLength(2);

    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const added = expectStatus(await call('post', '/me/smart-cart/add', customer.auth, { storeId: shop.store.id }), 200);
    expect(added.added.map((a) => a.name)).toEqual(['Toor Dal']);

    // Price changes reach every list: buy-again shows today's price.
    expectStatus(await call('patch', `${base(shop)}/products/${rice.product.id}/variants/${rice.halfKg.id}`, shop.merchant, { pricePaise: 5900 }), 200);
    const repriced = expectStatus(await call('get', `/me/buy-again?storeId=${shop.store.id}`, customer.auth), 200).products;
    expect(repriced.find((p) => p.id === rice.product.id).pricePaise).toBe(5900);
  });

  it('shopping lists and templates go into the cart through the normal rules, reporting what could not', async () => {
    const { shop, rice, dal } = await shopWithGoods();
    const customer = await flow.newCustomer();
    const { list } = expectStatus(
      await call('post', '/me/lists', customer.auth, {
        name: 'Weekly',
        kind: 'template',
        storeId: shop.store.id,
        repeatEveryDays: 7,
        items: [
          { productId: rice.product.id, variantId: rice.halfKg.id, quantity: 2 },
          { productId: dal.product.id, quantity: 1 },
          { label: 'Fresh coriander' },
        ],
      }),
      201,
    );
    expect(list.items).toHaveLength(3);
    expect(list.nextReminderOn).toBeTruthy();

    expectStatus(await call('post', `${base(shop)}/products/${dal.product.id}/deactivate`, shop.merchant, {}), 200);
    const result = expectStatus(await call('post', `/me/lists/${list.id}/add-to-cart`, customer.auth, {}), 200);
    expect(result.added.map((a) => a.name)).toEqual(['Basmati Rice']);
    expect(result.failed.map((f) => f.name)).toEqual(['Toor Dal']);
    expect(result.skipped).toEqual([{ label: 'Fresh coriander', reason: 'NOT_A_PRODUCT' }]);

    const { cart } = expectStatus(await call('get', `/cart?storeId=${shop.store.id}`, customer.auth), 200);
    expect(cart.lines[0]).toMatchObject({ variantId: rice.halfKg.id, quantity: 2 });

    const other = await flow.newCustomer('Other');
    expect((await call('get', `/me/lists/${list.id}`, other.auth)).status).toBe(404);
    expect((await call('post', `/me/lists/${list.id}/add-to-cart`, other.auth, {})).status).toBe(404);
  });

  it('computes deterministic personal metrics from the customer’s own orders', async () => {
    const { shop, rice, dal, oil } = await shopWithGoods();
    const customer = await flow.newCustomer();
    await buy(customer, shop, [[rice.product.id, rice.kg.id, 1], [dal.product.id, dal.variant.id, 1]]);
    await buy(customer, shop, [[rice.product.id, rice.kg.id, 1], [dal.product.id, dal.variant.id, 1], [oil.product.id, oil.variant.id, 1]]);

    const insights = expectStatus(await call('get', '/me/insights', customer.auth), 200).insights;
    expect(insights.basedOn.completedOrders).toBe(2);
    expect(insights.frequentProducts.slice(0, 2).map((p) => p.name).sort()).toEqual(['Basmati Rice', 'Toor Dal']);
    expect(insights.commonBaskets[0].products.map((p) => p.name).sort()).toEqual(['Basmati Rice', 'Toor Dal']);
    expect(insights.repeatRate).toBeCloseTo(2 / 3, 2);
    expect(insights.averageOrderPaise).toBe(Math.round((27000 + 45000) / 2));
    expect(insights.favouriteStores[0]).toMatchObject({ orders: 2 });
    expect(insights.preferred).toMatchObject({ fulfilment: 'pickup', payment: 'cash' });
  });
});
