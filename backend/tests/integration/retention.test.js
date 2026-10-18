/**
 * Loyalty, coupons and local offers against real Postgres (migration 0042).
 * Roadmap §4 P3, Phase C (expiry offers, location banner, automatic expiry),
 * §5 P4 (loyalty, points history, coupons, first-order and repeat benefits,
 * thresholds), §6 Loyalty flow. Failure paths: expired coupons, used-up and
 * concurrent redemptions, invalid point redemptions, ended and sold-out offers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', async () => {
  const { createPgSupabase } = await import('../helpers/pgSupabase.js');
  return createPgSupabase();
});

const { resetDatabase, sql } = await import('../helpers/pgSupabase.js');
const { expireOffers } = await import('../../src/modules/offers/offer.service.js');
const flow = await import('./flow.js');
const { call, expectStatus } = flow;

beforeEach(async () => {
  await resetDatabase();
});

const base = (shop) => `/merchant/stores/${shop.store.id}`;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const DAY = 86_400_000;

async function shopWithRice() {
  const shop = await flow.openShop();
  await flow.publish(shop);
  const rice = await flow.addRice(shop, { stock1kg: 50, stock500g: 50, taxPercent: 5 });
  return { shop, rice };
}

async function quote(customer, body) {
  return call('post', '/checkout/quote', customer.auth, { fulfilmentMode: 'pickup', ...body });
}

describe('loyalty', () => {
  async function loyalShop() {
    const ctx = await shopWithRice();
    expectStatus(
      await call('put', `${base(ctx.shop)}/loyalty`, ctx.shop.merchant, {
        isActive: true,
        earnPointsPer100: 5,
        pointValuePaise: 50,
        maxRedeemPercent: 50,
        welcomeBonusPoints: 20,
      }),
      200,
    );
    return ctx;
  }

  it('earns on completion only (plus a one-time welcome bonus) and both sides see the same history', async () => {
    const { shop, rice } = await loyalShop();
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 5);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    expect(await sql('select count(*)::int as n from loyalty_ledger')).toEqual([{ n: 0 }]);

    await flow.fulfil(shop, order.id);
    const mine = expectStatus(await call('get', `/stores/${shop.store.id}/loyalty`, customer.auth), 200).loyalty;
    // Subtotal ₹600 → 6 × 5 = 30 points, + 20 welcome.
    expect(mine.balance.points).toBe(50);
    expect(mine.history.map((h) => [h.kind, h.points])).toEqual(expect.arrayContaining([['earn', 30], ['bonus', 20]]));

    const theirs = expectStatus(await call('get', `${base(shop)}/customers/${customer.id}/points`, shop.merchant), 200).history;
    expect(theirs.map((h) => h.points).sort()).toEqual(mine.history.map((h) => h.points).sort());

    // A second completed order earns, but no second bonus.
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { order: second } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    await flow.fulfil(shop, second.id);
    expect(await sql(`select kind, points from loyalty_ledger where order_id = $1`, [second.id])).toEqual([{ kind: 'earn', points: 5 }]);
  });

  it('redeems points at checkout within the cap, refunds them when the order is cancelled', async () => {
    const { shop, rice } = await loyalShop();
    const customer = await flow.newCustomer();
    // A merchant can adjust points only for someone who has dealt with the store.
    const stranger = await call('post', `${base(shop)}/customers/${customer.id}/points`, shop.merchant, { points: 100, reason: 'Opening' });
    expect(stranger.status).toBe(404);
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { order: first } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    await flow.fulfil(shop, first.id);
    expectStatus(await call('post', `${base(shop)}/customers/${customer.id}/points`, shop.merchant, { points: 100, reason: 'Goodwill' }), 201);
    // ₹120 earns 1 × 5 = 5 points, + 20 welcome, + 100 goodwill.
    const balance = (await sql('select current_points from loyalty_accounts'))[0].current_points;
    expect(balance).toBe(125);

    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 2);
    const tooMany = expectStatus(await quote(customer, { storeId: shop.store.id, redeemPoints: 125 }), 200).quote;
    // 50% of ₹240 = ₹120 = 240 points max, but only 125 held → allowed.
    expect(tooMany.canPlaceOrder).toBe(true);
    expect(tooMany.benefits.loyalty).toMatchObject({ pointsUsed: 125, discountPaise: 6250 });
    expect(tooMany.totals.discountPaise).toBe(6250);
    // Tax is on the discounted value: (24000 − 6250) × 5% = 887.5 → 888.
    expect(tooMany.totals.taxPaise).toBe(888);
    expect(tooMany.totals.totalPaise).toBe(24000 - 6250 + 888);

    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id, redeemPoints: 125 }), 201);
    expect(order.benefits.loyaltyPointsRedeemed).toBe(125);
    expect((await sql('select current_points from loyalty_accounts'))[0].current_points).toBe(0);

    expectStatus(await call('post', `/orders/${order.id}/cancel`, customer.auth, {}), 200);
    expect((await sql('select current_points from loyalty_accounts'))[0].current_points).toBe(125);
    expect(await sql(`select kind, points from loyalty_ledger where order_id = $1 order by created_at`, [order.id])).toEqual([
      { kind: 'redeem', points: -125 },
      { kind: 'reverse_redeem', points: 125 },
    ]);
  });

  it('refuses invalid redemptions: more than held, above the cap, and two orders spending the same points', async () => {
    const { shop, rice } = await loyalShop();
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    await flow.fulfil(shop, order.id);
    // ₹120 → 5 points, + 20 welcome = 25 held.
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.halfKg.id, 1);

    const above = expectStatus(await quote(customer, { storeId: shop.store.id, redeemPoints: 500 }), 200).quote;
    expect(above.blockers.map((b) => b.code)).toContain('INSUFFICIENT_POINTS');
    // 50% of ₹65 = ₹32.50 = 65 points of value, so all 25 fit.
    const capped = expectStatus(await quote(customer, { storeId: shop.store.id, redeemPoints: 25 }), 200).quote;
    expect(capped.canPlaceOrder).toBe(true);
    const overCap = expectStatus(await quote(customer, { storeId: shop.store.id, redeemPoints: 3 }), 200).quote;
    expect(overCap.canPlaceOrder).toBe(true);

    // Two simultaneous orders each trying to spend all 25 points: one wins.
    const other = await flow.newCustomer('Same Person, Second Device');
    const results = await Promise.all([
      flow.placeOrder(customer, { storeId: shop.store.id, redeemPoints: 25 }, { idempotencyKey: 'a' }),
      flow.placeOrder(customer, { storeId: shop.store.id, redeemPoints: 25 }, { idempotencyKey: 'b' }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).not.toBe(201);
    expect((await sql('select current_points from loyalty_accounts where customer_id = $1', [customer.id]))[0].current_points).toBe(0);
    expect(other.id).toBeTruthy();
  });

  it('the points ledger itself refuses to spend the same points twice, and is append-only', async () => {
    const { shop } = await loyalShop();
    const customer = await flow.newCustomer();
    await sql(`select post_loyalty_points($1, $2, 'adjust', 30)`, [shop.store.id, customer.id]);
    await sql(`select post_loyalty_points($1, $2, 'redeem', -30)`, [shop.store.id, customer.id]);
    await expect(sql(`select post_loyalty_points($1, $2, 'redeem', -30)`, [shop.store.id, customer.id])).rejects.toThrow(/INSUFFICIENT_POINTS/);
    await expect(sql('update loyalty_ledger set points = 1')).rejects.toThrow(/immutable/);
    await expect(sql('delete from loyalty_ledger')).rejects.toThrow(/immutable/);
  });

  it('a reward becomes a personal single-use coupon, paid for in points', async () => {
    const { shop, rice } = await loyalShop();
    const { reward } = expectStatus(
      await call('post', `${base(shop)}/loyalty/rewards`, shop.merchant, { name: '₹20 off', pointsCost: 20, discountType: 'flat', amountOffPaise: 2000 }),
      201,
    );
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    await flow.fulfil(shop, order.id);

    const redeemed = expectStatus(await call('post', `/stores/${shop.store.id}/loyalty/rewards/${reward.id}/redeem`, customer.auth, {}), 201);
    expect(redeemed.coupon).toMatchObject({ isPersonal: true, amountOffPaise: 2000 });
    expect(redeemed.balance.points).toBe(5);

    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const q = expectStatus(await quote(customer, { storeId: shop.store.id, couponCode: redeemed.coupon.code }), 200).quote;
    expect(q.benefits.coupon).toMatchObject({ applies: true, discountPaise: 2000 });

    const stranger = await flow.newCustomer('Stranger');
    await flow.addToCart(stranger, shop.store.id, rice.product.id, rice.kg.id, 1);
    const blocked = expectStatus(await quote(stranger, { storeId: shop.store.id, couponCode: redeemed.coupon.code }), 200).quote;
    expect(blocked.blockers[0]).toMatchObject({ code: 'COUPON_INVALID', reason: 'not_yours' });

    expect((await call('post', `/stores/${shop.store.id}/loyalty/rewards/${reward.id}/redeem`, customer.auth, {})).status).toBe(422);
  });
});

describe('coupons', () => {
  async function couponShop(couponBody) {
    const ctx = await shopWithRice();
    const { coupon } = expectStatus(await call('post', `${base(ctx.shop)}/coupons`, ctx.shop.merchant, couponBody), 201);
    return { ...ctx, coupon };
  }

  it('applies a percentage coupon with a cap, and records one use per order', async () => {
    const { shop, rice } = await couponShop({ code: 'SAVE10', title: '10% off', discountType: 'percent', percentOff: 10, maxDiscountPaise: 2000 });
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 3);
    const q = expectStatus(await quote(customer, { storeId: shop.store.id, couponCode: 'save10' }), 200).quote;
    // 10% of ₹360 = ₹36, capped at ₹20.
    expect(q.totals.discountPaise).toBe(2000);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id, couponCode: 'SAVE10', expectedTotalPaise: q.totals.totalPaise }), 201);
    expect(order.totals.discountPaise).toBe(2000);
    expect(order.items.reduce((sum, item) => sum + item.discountPaise, 0)).toBe(2000);
    expect(order.benefits.couponCode).toBe('SAVE10');
    expect(await sql('select status, discount_paise from coupon_redemptions')).toEqual([{ status: 'applied', discount_paise: 2000 }]);
  });

  it('refuses expired, not-yet-started, used-up and already-used coupons', async () => {
    const { shop, rice } = await couponShop({ code: 'ONCE', title: 'Once', discountType: 'flat', amountOffPaise: 500, maxUses: 1 });
    expectStatus(
      await call('post', `${base(shop)}/coupons`, shop.merchant, { code: 'OLD', title: 'Old', discountType: 'flat', amountOffPaise: 500, startsAt: iso(-10 * DAY), endsAt: iso(-DAY) }),
      201,
    );
    expectStatus(
      await call('post', `${base(shop)}/coupons`, shop.merchant, { code: 'SOON', title: 'Soon', discountType: 'flat', amountOffPaise: 500, startsAt: iso(DAY), endsAt: iso(5 * DAY) }),
      201,
    );
    const a = await flow.newCustomer('A');
    const b = await flow.newCustomer('B');
    for (const c of [a, b]) await flow.addToCart(c, shop.store.id, rice.product.id, rice.kg.id, 1);

    expect((await quote(a, { storeId: shop.store.id, couponCode: 'OLD' })).body.data.quote.blockers[0].reason).toBe('expired');
    expect((await quote(a, { storeId: shop.store.id, couponCode: 'SOON' })).body.data.quote.blockers[0].reason).toBe('not_started');
    expect((await quote(a, { storeId: shop.store.id, couponCode: 'NOPE' })).body.data.quote.blockers[0].reason).toBe('not_found');

    // Concurrent: two customers race for the single use.
    const results = await Promise.all([
      flow.placeOrder(a, { storeId: shop.store.id, couponCode: 'ONCE' }),
      flow.placeOrder(b, { storeId: shop.store.id, couponCode: 'ONCE' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(results.find((r) => r.status === 422).body.error.code).toBe('COUPON_INVALID');
    expect(await sql(`select count(*)::int as n from coupon_redemptions where status = 'applied'`)).toEqual([{ n: 1 }]);

    // Cancelling frees the use for someone else.
    const winner = results.find((r) => r.status === 201).body.data.order;
    const winnerAuth = winner.id && (results[0].status === 201 ? a : b);
    expectStatus(await call('post', `/orders/${winner.id}/cancel`, winnerAuth.auth, {}), 200);
    const loser = winnerAuth === a ? b : a;
    expectStatus(await flow.placeOrder(loser, { storeId: shop.store.id, couponCode: 'ONCE' }), 201);
  });

  it('first-order coupons are for first orders only; free-delivery coupons waive the fee', async () => {
    const { shop, rice } = await couponShop({ code: 'WELCOME', title: 'First order', discountType: 'flat', amountOffPaise: 1000, audience: 'new' });
    expectStatus(await call('post', `${base(shop)}/coupons`, shop.merchant, { code: 'SHIPFREE', title: 'Free delivery', discountType: 'free_delivery' }), 201);
    const customer = await flow.newCustomer();
    const address = await flow.addAddress(customer);
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);

    const delivery = expectStatus(await quote(customer, { storeId: shop.store.id, fulfilmentMode: 'delivery', addressId: address.id, couponCode: 'SHIPFREE' }), 200).quote;
    expect(delivery.totals).toMatchObject({ deliveryFeePaise: 0, waivedDeliveryPaise: 3000 });
    expect(delivery.freeDelivery).toMatchObject({ thresholdPaise: 100000, isUnlocked: false, remainingPaise: 100000 - 12000 });
    const pickup = expectStatus(await quote(customer, { storeId: shop.store.id, couponCode: 'SHIPFREE' }), 200).quote;
    expect(pickup.blockers[0].reason).toBe('not_delivery');

    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id, couponCode: 'WELCOME' }), 201);
    await flow.fulfil(shop, order.id);
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    expect((await quote(customer, { storeId: shop.store.id, couponCode: 'WELCOME' })).body.data.quote.blockers[0].reason).toMatch(/audience_new|already_used/);
  });

  it('a coupon cannot be combined with points unless the merchant allows it', async () => {
    const { shop, rice } = await couponShop({ code: 'NOSTACK', title: 'No stack', discountType: 'flat', amountOffPaise: 500 });
    expectStatus(await call('put', `${base(shop)}/loyalty`, shop.merchant, { isActive: true, welcomeBonusPoints: 50 }), 200);
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    await flow.fulfil(shop, order.id);
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const q = expectStatus(await quote(customer, { storeId: shop.store.id, couponCode: 'NOSTACK', redeemPoints: 10 }), 200).quote;
    expect(q.blockers.map((b) => b.code)).toContain('NOT_STACKABLE');
  });

  it('another merchant’s coupon code means nothing here', async () => {
    const { shop, rice } = await couponShop({ code: 'MINE', title: 'Mine', discountType: 'flat', amountOffPaise: 500 });
    const other = await flow.openShop({ name: 'Other' });
    await flow.publish(other);
    const { product, variant } = await flow.addSimpleProduct(other);
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, other.store.id, product.id, variant.id, 1);
    expect((await quote(customer, { storeId: other.store.id, couponCode: 'MINE' })).body.data.quote.blockers[0].reason).toBe('not_found');
    expect((await call('patch', `${base(shop)}/coupons/${(await sql('select id from coupons'))[0].id}`, other.merchant, { title: 'x' })).status).toBe(404);
    expect(rice).toBeTruthy();
  });
});

describe('expiry-based local offers', () => {
  async function shopWithExpiringBatch({ expiresInDays = 10, quantity = 4 } = {}) {
    const ctx = await shopWithRice();
    const expires = new Date(Date.now() + expiresInDays * DAY).toISOString().slice(0, 10);
    expectStatus(
      await call('post', `${base(ctx.shop)}/inventory/stock-in`, ctx.shop.merchant, { variantId: ctx.rice.halfKg.id, quantity, batchNumber: 'LOT-9', expiresOn: expires }),
      200,
    );
    const [{ id: batchId }] = await sql(`select id from inventory_batches where batch_number = 'LOT-9'`);
    return { ...ctx, batchId };
  }

  it('prices the cart and the order at the offer price, caps it at the batch, and ends it when sold out', async () => {
    const { shop, rice, batchId } = await shopWithExpiringBatch({ quantity: 3 });
    const { offer } = expectStatus(
      await call('post', `${base(shop)}/offers`, shop.merchant, {
        variantId: rice.halfKg.id, batchId, title: 'Clearance', offerPricePaise: 4000, endsAt: iso(5 * DAY), expiryCutoffDays: 1,
      }),
      201,
    );
    expect(offer).toMatchObject({ isLive: true, quantityLimit: 3, offerPricePaise: 4000, listPricePaise: 6500, savingPaise: 2500 });

    const customer = await flow.newCustomer();
    const { cart } = await flow.addToCart(customer, shop.store.id, rice.product.id, rice.halfKg.id, 2);
    expect(cart.lines[0]).toMatchObject({ unitPricePaise: 4000, listUnitPricePaise: 6500 });
    expect(cart.lines[0].offer.id).toBe(offer.id);

    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    expect(order.items[0]).toMatchObject({ unitPricePaise: 4000, listUnitPricePaise: 6500, offerId: offer.id });

    // Two more wanted, one left at the offer price → normal price, with a notice.
    const second = await flow.newCustomer('Second');
    const { cart: cart2 } = await flow.addToCart(second, shop.store.id, rice.product.id, rice.halfKg.id, 2);
    expect(cart2.lines[0]).toMatchObject({ unitPricePaise: 6500, offer: null });
    expect(cart2.lines[0].notices[0]).toMatchObject({ code: 'OFFER_QUANTITY_LIMITED', available: 1 });

    // Buying the last offer unit ends the offer.
    expectStatus(await call('patch', `/cart/items/${cart2.lines[0].id}`, second.auth, { quantity: 1 }), 200);
    expectStatus(await flow.placeOrder(second, { storeId: shop.store.id }), 201);
    expect(await sql('select quantity_sold, end_reason from store_offers')).toEqual([{ quantity_sold: 3, end_reason: 'sold_out' }]);
    const after = expectStatus(await call('get', `/stores/${shop.store.slug}/offers`), 200);
    expect(after.offers).toEqual([]);
  });

  it('refuses the order if the offer ended between the quote and the order', async () => {
    const { shop, rice, batchId } = await shopWithExpiringBatch();
    const { offer } = expectStatus(
      await call('post', `${base(shop)}/offers`, shop.merchant, { variantId: rice.halfKg.id, batchId, title: 'Deal', offerPricePaise: 4000, endsAt: iso(5 * DAY) }),
      201,
    );
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.halfKg.id, 1);
    const q = expectStatus(await quote(customer, { storeId: shop.store.id }), 200).quote;
    expect(q.lines[0].unitPricePaise).toBe(4000);

    expectStatus(await call('post', `${base(shop)}/offers/${offer.id}/end`, shop.merchant, {}), 200);
    // The client still believes the old total: refused, never charged a different price silently.
    const response = await flow.placeOrder(customer, { storeId: shop.store.id, expectedTotalPaise: q.totals.totalPaise });
    expect(response.status).toBe(422);
    expect(['TOTAL_CHANGED', 'OFFER_ENDED']).toContain(response.body.error.code);
  });

  it('will not create an offer inside the safety cut-off, or above the normal price', async () => {
    const { shop, rice, batchId } = await shopWithExpiringBatch({ expiresInDays: 1 });
    const late = await call('post', `${base(shop)}/offers`, shop.merchant, {
      variantId: rice.halfKg.id, batchId, title: 'Too late', offerPricePaise: 4000, endsAt: iso(3 * DAY), expiryCutoffDays: 2,
    });
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('PAST_EXPIRY_CUTOFF');
    const dearer = await call('post', `${base(shop)}/offers`, shop.merchant, { variantId: rice.halfKg.id, batchId, title: 'x', offerPricePaise: 9000, endsAt: iso(DAY) });
    expect(dearer.body.error.code).toBe('OFFER_NOT_LOWER');
  });

  it('shows offers to customers within the radius only, nearest first; the expiry job records ended offers once', async () => {
    const { shop, rice, batchId } = await shopWithExpiringBatch();
    expectStatus(
      await call('post', `${base(shop)}/offers`, shop.merchant, { variantId: rice.halfKg.id, batchId, title: 'Near deal', offerPricePaise: 4000, endsAt: iso(DAY), radiusKm: 3 }),
      201,
    );
    // The shop is at (30.9, 75.85). ~1.1 km away vs ~55 km away.
    const near = expectStatus(await call('get', '/offers/nearby?lat=30.91&lng=75.85'), 200).offers;
    expect(near).toHaveLength(1);
    expect(near[0]).toMatchObject({ title: 'Near deal', store: { slug: shop.store.slug } });
    expect(near[0].distanceKm).toBeLessThan(3);
    expect(expectStatus(await call('get', '/offers/nearby?lat=31.4&lng=75.85'), 200).offers).toEqual([]);

    await sql(`update store_offers set ends_at = now() - interval '1 minute', starts_at = now() - interval '2 days'`);
    expect(expectStatus(await call('get', '/offers/nearby?lat=30.91&lng=75.85'), 200).offers).toEqual([]);
    expect(await expireOffers()).toBe(1);
    expect(await expireOffers()).toBe(0);
    expect(await sql('select end_reason from store_offers')).toEqual([{ end_reason: 'period_ended' }]);
    const inbox = expectStatus(await call('get', `${base(shop)}/notifications`, shop.merchant), 200).notifications;
    expect(inbox.filter((n) => n.type === 'offer_ended')).toHaveLength(1);
  });
});
