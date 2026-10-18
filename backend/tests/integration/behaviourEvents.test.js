/**
 * Cart behaviour events (roadmap §5 P6) against real Postgres: a cart_add is
 * recorded only when an item really went in, an abandoned cart is recorded
 * once per idle spell and never for a cart that was ordered, emptied, or
 * belongs to a customer who turned activity off — and clients cannot post
 * either event.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', async () => {
  const { createPgSupabase } = await import('../helpers/pgSupabase.js');
  return createPgSupabase();
});

const { resetDatabase, sql } = await import('../helpers/pgSupabase.js');
const { supabaseAdmin } = await import('../../src/lib/supabase.js');
const { recordAbandonedCarts } = await import('../../src/modules/engagement/cartEvents.js');
const flow = await import('./flow.js');
const { call, expectStatus } = flow;

beforeEach(async () => {
  await resetDatabase();
  vi.restoreAllMocks();
});

async function setup() {
  const shop = await flow.openShop();
  await flow.publish(shop);
  const rice = await flow.addRice(shop, { stock1kg: 5 });
  const customer = await flow.newCustomer();
  return { shop, rice, customer };
}

const events = (type) => sql('select customer_id, store_id, product_id, variant_id, properties, dedupe_key from customer_events where event_type = $1 order by created_at', [type]);

/** Moves a cart's activity into the past (the updated_at triggers are paused for it). */
async function idleCart(customerId, hours) {
  await sql('alter table carts disable trigger carts_set_updated_at');
  await sql('alter table cart_items disable trigger cart_items_set_updated_at');
  try {
    await sql(`update carts set updated_at = now() - make_interval(hours => $2::int) where customer_id = $1 and checked_out_at is null`, [customerId, hours]);
    await sql(
      `update cart_items set created_at = now() - make_interval(hours => $2::int), updated_at = now() - make_interval(hours => $2::int)
        where cart_id in (select id from carts where customer_id = $1 and checked_out_at is null)`,
      [customerId, hours],
    );
  } finally {
    await sql('alter table carts enable trigger carts_set_updated_at');
    await sql('alter table cart_items enable trigger cart_items_set_updated_at');
  }
}

describe('cart_add', () => {
  it('is recorded once per successful add, with ids and quantity only', async () => {
    const { shop, rice, customer } = await setup();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 2);
    const rows = await events('cart_add');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customer_id: customer.id, store_id: shop.store.id, product_id: rice.product.id, variant_id: rice.kg.id, properties: { quantity: 2 } });
    expect(Object.keys(rows[0].properties)).toEqual(['quantity']);
  });

  it('records nothing when the add is refused', async () => {
    const { shop, rice, customer } = await setup();
    const refused = await call('post', '/cart/items', customer.auth, { storeId: shop.store.id, productId: rice.product.id, variantId: rice.kg.id, quantity: 50 });
    expect(refused.status).toBe(422);
    expect(await events('cart_add')).toEqual([]);
  });

  it('is recorded on every path that adds through the cart (buy again, lists)', async () => {
    const { shop, rice, customer } = await setup();
    const { list } = expectStatus(await call('post', '/me/lists', customer.auth, { name: 'Weekly', items: [{ productId: rice.product.id, variantId: rice.halfKg.id, quantity: 1 }] }), 201);
    expectStatus(await call('post', `/me/lists/${list.id}/add-to-cart`, customer.auth, { storeId: shop.store.id }), 200);
    expect((await events('cart_add')).map((e) => e.variant_id)).toEqual([rice.halfKg.id]);
  });

  it('respects a customer who turned activity off', async () => {
    const { shop, rice, customer } = await setup();
    expectStatus(await call('patch', '/me/preferences', customer.auth, { activityTracking: false }), 200);
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    expect(await events('cart_add')).toEqual([]);
  });

  it('never fails the add if the event cannot be written', async () => {
    const { shop, rice, customer } = await setup();
    const real = supabaseAdmin.from.bind(supabaseAdmin);
    vi.spyOn(supabaseAdmin, 'from').mockImplementation((table) => {
      if (table === 'customer_events') throw new Error('event store down');
      return real(table);
    });
    const { cart } = await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    expect(cart.lines).toHaveLength(1);
    vi.restoreAllMocks();
    expect(await events('cart_add')).toEqual([]);
  });

  it('cannot be posted by a client, and events need a signed-in customer', async () => {
    const { shop, rice, customer } = await setup();
    for (const eventType of ['cart_add', 'cart_abandon']) {
      const posted = await call('post', '/me/events', customer.auth, { eventType, storeId: shop.store.id, productId: rice.product.id });
      expect(posted.status).toBe(422);
    }
    expect((await call('post', '/me/events', null, { eventType: 'store_view', storeId: shop.store.id })).status).toBe(401);
    expect((await call('post', '/me/events', shop.merchant, { eventType: 'store_view', storeId: shop.store.id })).status).toBe(403);
    expect(await sql(`select count(*)::int as n from customer_events where event_type in ('cart_add', 'cart_abandon')`)).toEqual([{ n: 0 }]);
  });
});

describe('abandoned carts', () => {
  it('records an idle cart once per idle spell, and again after new activity goes idle', async () => {
    const { shop, rice, customer } = await setup();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    await idleCart(customer.id, 25);

    expect(await recordAbandonedCarts()).toEqual({ recorded: 1, skipped: 0 });
    expect(await recordAbandonedCarts()).toEqual({ recorded: 0, skipped: 0 });
    const [first] = await events('cart_abandon');
    expect(first).toMatchObject({ customer_id: customer.id, store_id: shop.store.id, product_id: null, properties: { item_count: 1 } });
    expect(Object.keys(first.properties).sort()).toEqual(['cart_id', 'item_count', 'last_activity_at']);

    // The customer comes back, then leaves again: a second, separate spell.
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.halfKg.id, 1);
    expect(await recordAbandonedCarts()).toEqual({ recorded: 0, skipped: 0 });
    await idleCart(customer.id, 30);
    expect(await recordAbandonedCarts()).toEqual({ recorded: 1, skipped: 0 });
    expect(await events('cart_abandon')).toHaveLength(2);
  });

  it('two runs at once still record it once', async () => {
    const { shop, rice, customer } = await setup();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    await idleCart(customer.id, 25);
    const results = await Promise.all([recordAbandonedCarts(), recordAbandonedCarts()]);
    expect(results.reduce((sum, r) => sum + r.recorded, 0)).toBe(1);
    expect(await events('cart_abandon')).toHaveLength(1);
  });

  it('is not recorded for a recent, empty, ordered, very old, or untracked cart', async () => {
    const { shop, rice, customer } = await setup();

    // Recent: 23 hours is not abandoned.
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    await idleCart(customer.id, 23);
    expect((await recordAbandonedCarts()).recorded).toBe(0);

    // Very old: outside the 30-day window, not backfilled.
    await idleCart(customer.id, 31 * 24);
    expect((await recordAbandonedCarts()).recorded).toBe(0);

    // Empty: lines removed.
    await idleCart(customer.id, 0);
    expectStatus(await call('delete', `/cart?storeId=${shop.store.id}`, customer.auth), 200);
    await idleCart(customer.id, 25);
    expect((await recordAbandonedCarts()).recorded).toBe(0);

    // Ordered: the basket became an order.
    const buyer = await flow.newCustomer('Buyer');
    await flow.addToCart(buyer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { order } = expectStatus(await flow.placeOrder(buyer, { storeId: shop.store.id }), 201);
    await idleCart(buyer.id, 25);
    expect((await recordAbandonedCarts()).recorded).toBe(0); // checked out: not open
    // Even a cart left open by a crash is not "abandoned" once its basket was ordered.
    const [buyerCart] = await sql(`update carts set checked_out_at = null where customer_id = $1 returning id`, [buyer.id]);
    await sql(`insert into cart_items (cart_id, product_id, variant_id, quantity) values ($1, $2, $3, 1)`, [buyerCart.id, rice.product.id, rice.kg.id]);
    await idleCart(buyer.id, 25);
    await sql(`update orders set placed_at = now() - interval '1 hour' where id = $1`, [order.id]);
    expect((await recordAbandonedCarts()).recorded).toBe(0);

    // Untracked: the customer turned activity off.
    const privateOne = await flow.newCustomer('Private');
    expectStatus(await call('patch', '/me/preferences', privateOne.auth, { activityTracking: false }), 200);
    await flow.addToCart(privateOne, shop.store.id, rice.product.id, rice.halfKg.id, 1);
    await idleCart(privateOne.id, 25);
    expect(await recordAbandonedCarts()).toEqual({ recorded: 0, skipped: 1 });

    expect(await events('cart_abandon')).toEqual([]);
  });

  it('the database refuses a second event with the same dedupe key', async () => {
    const { shop, customer } = await setup();
    const insert = () => sql(`insert into customer_events (customer_id, store_id, event_type, dedupe_key) values ($1, $2, 'cart_abandon', 'cart_abandon:x:t')`, [customer.id, shop.store.id]);
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key|unique/i);
  });
});
