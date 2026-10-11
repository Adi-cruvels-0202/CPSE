/**
 * Conversations, support escalation, substitutions and announcements against
 * real Postgres (migration 0043). Roadmap §5 P3 (ask the shop, special
 * requests, order messaging, store-specific notifications), P5 (transparent
 * substitutions with approval, customer support / escalation).
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

const base = (shop) => `/merchant/stores/${shop.store.id}`;

async function shopAndCustomer() {
  const shop = await flow.openShop();
  await flow.publish(shop);
  const rice = await flow.addRice(shop, { stock1kg: 20, stock500g: 20, taxPercent: 0 });
  const customer = await flow.newCustomer();
  return { shop, rice, customer };
}

describe('asking the shop', () => {
  it('a question reaches the store, the reply reaches the customer, and only they two can read it', async () => {
    const { shop, rice, customer } = await shopAndCustomer();
    const { conversation } = expectStatus(
      await call('post', '/conversations', customer.auth, {
        kind: 'question',
        storeId: shop.store.id,
        productId: rice.product.id,
        subject: 'Is this aged rice?',
        message: 'How old is the basmati?',
      }),
      201,
    );
    expect(conversation).toMatchObject({ status: 'awaiting_store', product: { name: 'Basmati Rice' } });

    const inbox = expectStatus(await call('get', `${base(shop)}/conversations`, shop.merchant), 200).conversations;
    expect(inbox[0]).toMatchObject({ id: conversation.id, isUnread: true, customer: { name: 'Asha Verma' } });

    const replied = expectStatus(
      await call('post', `${base(shop)}/conversations/${conversation.id}/messages`, shop.merchant, { body: 'Aged two years.' }),
      201,
    ).conversation;
    expect(replied.messages.map((m) => m.from)).toEqual(['customer', 'merchant']);
    expect(replied.status).toBe('awaiting_customer');
    expect((await sql(`select count(*)::int as n from notifications where type = 'message' and customer_id = $1`, [customer.id]))[0].n).toBe(1);

    const stranger = await flow.newCustomer('Stranger');
    expect((await call('get', `/conversations/${conversation.id}`, stranger.auth)).status).toBe(404);
    const other = await flow.openShop({ name: 'Other' });
    expect((await call('get', `${base(other)}/conversations/${conversation.id}`, other.merchant)).status).toBe(404);
    await expect(sql(`update messages set body = 'x'`)).rejects.toThrow(/immutable/);
  });

  it('special requests carry their type; an order conversation must be about the customer’s own order', async () => {
    const { shop, rice, customer } = await shopAndCustomer();
    expectStatus(
      await call('post', '/conversations', customer.auth, {
        kind: 'special_request',
        storeId: shop.store.id,
        requestType: 'bulk_order',
        subject: '25 kg for a wedding',
        message: 'Can you arrange 25 kg by Friday?',
      }),
      201,
    );
    expect((await sql('select type from merchant_notifications where type = $1', ['special_request'])).length).toBe(1);

    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    const stranger = await flow.newCustomer('Stranger');
    expect(
      (await call('post', '/conversations', stranger.auth, { kind: 'order', orderId: order.id, subject: 'x', message: 'y' })).status,
    ).toBe(404);
    expect((await call('post', '/conversations', customer.auth, { kind: 'order', subject: 'x', message: 'y' })).status).toBe(422);
  });

  it('escalates an order problem to CPSE support, where a reviewer can reply', async () => {
    const { shop, rice, customer } = await shopAndCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    const { conversation } = expectStatus(
      await call('post', '/conversations', customer.auth, { kind: 'support', orderId: order.id, subject: 'Wrong item', message: 'I got sugar, not rice.' }),
      201,
    );
    const admin = await flow.newAdmin();
    expect((await call('get', `/admin/support/${conversation.id}`, admin.auth)).status).toBe(404);

    const escalated = expectStatus(await call('post', `/conversations/${conversation.id}/escalate`, customer.auth, { reason: 'No reply in two days' }), 200).conversation;
    expect(escalated.status).toBe('escalated');
    expect(escalated.messages.at(-1)).toMatchObject({ from: 'system' });

    const queue = expectStatus(await call('get', '/admin/support', admin.auth), 200).conversations;
    expect(queue.map((c) => c.id)).toEqual([conversation.id]);
    const answered = expectStatus(
      await call('post', `/admin/support/${conversation.id}/messages`, admin.auth, { body: 'We have asked the store to replace it.', resolve: true }),
      201,
    ).conversation;
    expect(answered.status).toBe('resolved');
    expect((await sql(`select count(*)::int as n from notifications where type = 'support_update'`))[0].n).toBe(1);
    expect((await call('get', '/admin/support', shop.merchant)).status).toBe(403);
  });
});

describe('automatic escalation of unanswered order conversations', () => {
  it('passes an order conversation the shop left for a day to support, once; questions and fresh ones stay', async () => {
    const { escalateUnanswered } = await import('../../src/modules/messaging/messaging.service.js');
    const { shop, rice, customer } = await shopAndCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    const start = (body) => call('post', '/conversations', customer.auth, body);
    const stale = expectStatus(await start({ kind: 'order', orderId: order.id, subject: 'Where is my order?', message: 'Still not here.' }), 201).conversation;
    const fresh = expectStatus(await start({ kind: 'order', orderId: order.id, subject: 'Can you add a bag?', message: 'Thanks.' }), 201).conversation;
    const question = expectStatus(await start({ kind: 'question', storeId: shop.store.id, subject: 'Do you stock ghee?', message: '1 kg?' }), 201).conversation;
    await sql(`update conversations set last_message_at = now() - interval '25 hours' where id = any($1)`, [[stale.id, question.id]]);

    expect(await escalateUnanswered()).toEqual({ escalated: 1 });
    expect(await escalateUnanswered()).toEqual({ escalated: 0 });

    const after = expectStatus(await call('get', `/conversations/${stale.id}`, customer.auth), 200).conversation;
    expect(after.status).toBe('escalated');
    expect(after.messages.at(-1)).toMatchObject({ from: 'system' });
    expect(after.messages.at(-1).body).toContain('No reply from the shop in 24 hours');
    expect(expectStatus(await call('get', `/conversations/${fresh.id}`, customer.auth), 200).conversation.status).toBe('awaiting_store');
    expect(expectStatus(await call('get', `/conversations/${question.id}`, customer.auth), 200).conversation.status).toBe('awaiting_store');

    const admin = await flow.newAdmin();
    expect(expectStatus(await call('get', '/admin/support', admin.auth), 200).conversations.map((c) => c.id)).toEqual([stale.id]);
    expect((await sql(`select count(*)::int as n from merchant_notifications where type = 'support_ticket'`))[0].n).toBe(1);
    expect((await sql(`select count(*)::int as n from notifications where type = 'support_update'`))[0].n).toBe(1);
  });

  it('a shop reply in time keeps the conversation with the shop', async () => {
    const { escalateUnanswered } = await import('../../src/modules/messaging/messaging.service.js');
    const { shop, rice, customer } = await shopAndCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    const c = expectStatus(await call('post', '/conversations', customer.auth, { kind: 'order', orderId: order.id, subject: 'Timing', message: 'When?' }), 201).conversation;
    expectStatus(await call('post', `${base(shop)}/conversations/${c.id}/messages`, shop.merchant, { body: 'By 6 pm.' }), 201);
    await sql(`update conversations set last_message_at = now() - interval '30 hours' where id = $1`, [c.id]);
    expect(await escalateUnanswered()).toEqual({ escalated: 0 });
  });
});

describe('substitutions', () => {
  async function orderWith(customer, shop, rice, body = {}) {
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 2);
    return expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id, ...body }), 201).order;
  }

  it('waits for the customer, then moves the stock and lowers the bill when approved', async () => {
    const { shop, rice, customer } = await shopAndCustomer();
    const order = await orderWith(customer, shop, rice);
    const item = order.items[0];
    // Two 500 g packs instead of two 1 kg: cheaper.
    const { substitution } = expectStatus(
      await call('post', `${base(shop)}/orders/${order.id}/substitutions`, shop.merchant, { orderItemId: item.id, variantId: rice.halfKg.id, note: '1 kg sold out' }),
      201,
    );
    expect(substitution).toMatchObject({ status: 'pending', savingPaise: 24000 - 13000 });
    expect((await sql(`select count(*)::int as n from notifications where type = 'substitution_requested'`))[0].n).toBe(1);

    const answered = expectStatus(await call('post', `/substitutions/${substitution.id}/respond`, customer.auth, { approve: true }), 200).substitution;
    expect(answered.status).toBe('approved');

    const detail = expectStatus(await call('get', `/orders/${order.id}`, customer.auth), 200).order;
    expect(detail.items).toEqual([expect.objectContaining({ variantId: rice.halfKg.id, quantity: 2, unitPricePaise: 6500 })]);
    expect(detail.replacedItems).toEqual([expect.objectContaining({ variantId: rice.kg.id, isActive: false })]);
    expect(detail.totals.totalPaise).toBe(13000);
    expect(await sql('select sku, reserved_quantity from product_variants where product_id = $1 order by sku', [rice.product.id])).toEqual([
      { sku: 'RICE-1KG', reserved_quantity: 0 },
      { sku: 'RICE-500G', reserved_quantity: 2 },
    ]);

    // Completing takes the substitute off the shelf, not the original.
    await flow.fulfil(shop, order.id);
    expect(await sql('select sku, quantity_on_hand from product_variants where product_id = $1 order by sku', [rice.product.id])).toEqual([
      { sku: 'RICE-1KG', quantity_on_hand: 20 },
      { sku: 'RICE-500G', quantity_on_hand: 18 },
    ]);
    expect((await call('post', `/substitutions/${substitution.id}/respond`, customer.auth, { approve: false })).status).toBe(409);
  });

  it('a dearer replacement costs the customer no more; a declined one changes nothing', async () => {
    const { shop, rice, customer } = await shopAndCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.halfKg.id, 1);
    const order = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201).order;
    const { substitution } = expectStatus(
      await call('post', `${base(shop)}/orders/${order.id}/substitutions`, shop.merchant, { orderItemId: order.items[0].id, variantId: rice.kg.id }),
      201,
    );
    expect(substitution.proposed.linePaise).toBe(6500);

    expectStatus(await call('post', `/substitutions/${substitution.id}/respond`, customer.auth, { approve: false, note: 'I will wait' }), 200);
    const detail = expectStatus(await call('get', `/orders/${order.id}`, customer.auth), 200).order;
    expect(detail.items[0].variantId).toBe(rice.halfKg.id);
    expect(detail.totals.totalPaise).toBe(6500);
  });

  it('applies a cheaper substitute at once for "allow similar", refunding the difference on a prepaid order', async () => {
    const { shop, rice, customer } = await shopAndCustomer();
    const order = await orderWith(customer, shop, rice, { paymentMethod: 'online', substitutionPreference: 'allow_similar' });
    await flow.payOnline(customer, order.id);

    const { substitution } = expectStatus(
      await call('post', `${base(shop)}/orders/${order.id}/substitutions`, shop.merchant, { orderItemId: order.items[0].id, variantId: rice.halfKg.id }),
      201,
    );
    expect(substitution).toMatchObject({ status: 'approved', autoApproved: true });

    const detail = expectStatus(await call('get', `/orders/${order.id}`, customer.auth), 200).order;
    expect(detail.paymentStatus).toBe('paid');
    expect(detail.refund).toBeNull();
    expect(detail.refundAdjustments).toEqual([
      expect.objectContaining({ kind: 'adjustment', amountPaise: 24000 - 13000, method: 'provider', status: 'processing' }),
    ]);

    // Cancelling later refunds only what is still unrefunded.
    expectStatus(await call('post', `/orders/${order.id}/cancel`, customer.auth, {}), 200);
    const after = expectStatus(await call('get', `/orders/${order.id}`, customer.auth), 200).order;
    expect(after.refund).toMatchObject({ kind: 'cancellation', amountPaise: 13000 });
  });

  it('cannot be proposed against "no substitutions", by another store, or after the order is ready', async () => {
    const { shop, rice, customer } = await shopAndCustomer();
    const strict = await orderWith(customer, shop, rice, { substitutionPreference: 'no_substitutions' });
    const refused = await call('post', `${base(shop)}/orders/${strict.id}/substitutions`, shop.merchant, { orderItemId: strict.items[0].id, variantId: rice.halfKg.id });
    expect(refused.body.error.code).toBe('NO_SUBSTITUTIONS');

    const other = await flow.openShop({ name: 'Other' });
    expect(
      (await call('post', `${base(other)}/orders/${strict.id}/substitutions`, other.merchant, { orderItemId: strict.items[0].id, variantId: rice.halfKg.id })).status,
    ).toBe(404);

    const ready = await orderWith(customer, shop, rice);
    const b = `${base(shop)}/orders/${ready.id}`;
    expectStatus(await call('post', `${b}/accept`, shop.merchant, {}), 200);
    expectStatus(await call('post', `${b}/status`, shop.merchant, { status: 'preparing' }), 200);
    expectStatus(await call('post', `${b}/status`, shop.merchant, { status: 'ready_for_pickup' }), 200);
    expect((await call('post', `${b}/substitutions`, shop.merchant, { orderItemId: ready.items[0].id, variantId: rice.halfKg.id })).status).toBe(409);
  });
});

describe('store announcements', () => {
  it('reach only followers who opted in to promotions, and are capped per day', async () => {
    const { shop } = await shopAndCustomer();
    const fan = await flow.newCustomer('Fan');
    const quiet = await flow.newCustomer('Quiet');
    for (const c of [fan, quiet]) expectStatus(await call('post', `/stores/${shop.store.id}/save`, c.auth, {}), 200);
    expectStatus(await call('put', `/stores/${shop.store.id}/preferences`, fan.auth, { allowPromotions: true }), 200);

    const audience = expectStatus(await call('get', `${base(shop)}/announcements`, shop.merchant), 200).audience;
    expect(audience).toEqual({ followers: 2, optedIn: 1 });

    const { announcement } = expectStatus(await call('post', `${base(shop)}/announcements`, shop.merchant, { title: 'Fresh mangoes in', body: 'Alphonso today' }), 201);
    expect(announcement.recipientCount).toBe(1);
    expect((await sql(`select customer_id from notifications where type = 'store_update'`)).map((r) => r.customer_id)).toEqual([fan.id]);

    expectStatus(await call('post', `${base(shop)}/announcements`, shop.merchant, { title: 'Two' }), 201);
    expectStatus(await call('post', `${base(shop)}/announcements`, shop.merchant, { title: 'Three' }), 201);
    expect((await call('post', `${base(shop)}/announcements`, shop.merchant, { title: 'Four' })).status).toBe(429);
  });
});
