/**
 * Running the shop from WhatsApp (migration 0048) against real Postgres:
 * linking a number by code, Meta's webhook check and signature, and every
 * command a linked owner can send — orders, actions, sales, stock, closing for
 * the day, switching shop, unlinking — plus new-order alerts.
 *
 * WHATSAPP_PROVIDER is `none` in tests, so nothing leaves the process: every
 * reply is recorded in whatsapp_messages (status `skipped`) and read back here.
 */
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', async () => {
  const { createPgSupabase } = await import('../helpers/pgSupabase.js');
  return createPgSupabase();
});

const { resetDatabase, sql } = await import('../helpers/pgSupabase.js');
const { api, url } = await import('../helpers/app.js');
const flow = await import('./flow.js');
const { call, expectStatus } = flow;

const SECRET = process.env.WHATSAPP_APP_SECRET;
const PHONE = '919812300001';

beforeEach(async () => {
  await resetDatabase();
});

let messageCounter = 0;

/** What Meta POSTs for one message from `from`: typed text, or a tapped button/list row. */
function metaPayload(from, { text, replyId, title = 'tap' }) {
  const message = replyId
    ? { from, id: `wamid.${++messageCounter}`, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: replyId, title } } }
    : { from, id: `wamid.${++messageCounter}`, type: 'text', text: { body: text } };
  return { object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', messages: [message] } }] }] };
}

function postWebhook(payload, { signature } = {}) {
  const body = JSON.stringify(payload);
  const sig = signature ?? `sha256=${crypto.createHmac('sha256', SECRET).update(body).digest('hex')}`;
  return api().post(url('/whatsapp/webhook')).set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(body);
}

/** Sends a message as `from` and returns the replies it produced, newest last. */
async function say(from, what) {
  const before = (await sql(`select count(*)::int as n from whatsapp_messages where direction = 'out' and phone = $1`, [from]))[0].n;
  const res = await postWebhook(metaPayload(from, typeof what === 'string' ? { text: what } : what));
  expect(res.status).toBe(200);
  const rows = await sql(`select body from whatsapp_messages where direction = 'out' and phone = $1 order by created_at, id`, [from]);
  return rows.slice(before).map((r) => r.body);
}

/** A shop with rice in stock and its owner's WhatsApp linked. */
async function linkedShop() {
  const shop = await flow.openShop();
  await flow.publish(shop);
  const rice = await flow.addRice(shop, { stock1kg: 20, stock500g: 4 });
  const { linking } = expectStatus(await call('post', '/merchant/whatsapp/link', shop.merchant, { phone: '+91 98123 00001' }), 201);
  const replies = await say(PHONE, linking.message);
  expect(replies.at(-1)).toContain('WhatsApp linked');
  return { shop, rice };
}

async function orderFor(shop, rice, quantity = 2) {
  const customer = await flow.newCustomer();
  await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, quantity);
  const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
  return order;
}

const code = (orderNumber) => orderNumber.split('-').pop();
const orderStatus = async (id) => (await sql('select status from orders where id = $1', [id]))[0].status;

describe("Meta's webhook", () => {
  it('answers the registration check only with the right verify token', async () => {
    const ok = await api().get(url('/whatsapp/webhook')).query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-whatsapp-verify-token', 'hub.challenge': '42abc' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('42abc');
    const bad = await api().get(url('/whatsapp/webhook')).query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': '42abc' });
    expect(bad.status).toBe(403);
  });

  it('refuses a call without a valid signature and acts on nothing', async () => {
    const res = await postWebhook(metaPayload(PHONE, { text: 'orders' }), { signature: 'sha256=00ff' });
    expect(res.status).toBe(403);
    expect(await sql('select count(*)::int as n from whatsapp_messages')).toEqual([{ n: 0 }]);
  });
});

describe('linking a number', () => {
  it('needs the code from that same number, and then the owner is in', async () => {
    const shop = await flow.openShop();
    const { linking } = expectStatus(await call('post', '/merchant/whatsapp/link', shop.merchant, { phone: '98123 00001' }), 201);
    expect(linking).toMatchObject({ phone: PHONE, message: expect.stringMatching(/^LINK \d{6}$/) });
    expect(linking.chatLink).toBe(`https://wa.me/919000000001?text=${encodeURIComponent(linking.message)}`);

    // Another number sending the right code links nothing.
    expect((await say('919800000099', linking.message)).at(-1)).toContain('not linked');
    // The right number with a wrong code is told so.
    expect((await say(PHONE, 'LINK 000000')).at(-1)).toContain('not right');
    // Nothing is acted on before the link is complete.
    expect((await say(PHONE, 'orders')).at(-1)).toContain('not linked');

    expect((await say(PHONE, linking.message)).at(-1)).toContain('WhatsApp linked');
    const { whatsapp } = expectStatus(await call('get', '/merchant/whatsapp', shop.merchant), 200);
    expect(whatsapp.link).toMatchObject({ phone: PHONE, status: 'active', notifyOrders: true, activeStoreId: shop.store.id });
  });

  it('gives up on a code after five wrong tries', async () => {
    const shop = await flow.openShop();
    const { linking } = expectStatus(await call('post', '/merchant/whatsapp/link', shop.merchant, { phone: PHONE }), 201);
    for (let i = 0; i < 5; i += 1) await say(PHONE, 'LINK 111111');
    expect((await say(PHONE, linking.message)).at(-1)).toContain('expired');
  });

  it('one number belongs to one account', async () => {
    await linkedShop();
    const other = await flow.openShop({ name: 'Other Shop' });
    const res = await call('post', '/merchant/whatsapp/link', other.merchant, { phone: PHONE });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PHONE_TAKEN');
  });

  it('refuses a number that is not a phone number', async () => {
    const shop = await flow.openShop();
    expect((await call('post', '/merchant/whatsapp/link', shop.merchant, { phone: 'call me later' })).status).toBe(422);
  });

  it('unlinking from the app stops the number at once', async () => {
    const { shop } = await linkedShop();
    expectStatus(await call('delete', '/merchant/whatsapp/link', shop.merchant), 200);
    expect((await say(PHONE, 'orders')).at(-1)).toContain('not linked');
  });

  it('needs a merchant session', async () => {
    expect((await call('get', '/merchant/whatsapp')).status).toBe(401);
  });
});

describe('orders from WhatsApp', () => {
  it('lists open orders and walks one from accepted to completed', async () => {
    const { shop, rice } = await linkedShop();
    const order = await orderFor(shop, rice);
    const c = code(order.orderNumber);

    const list = (await say(PHONE, 'orders')).at(-1);
    expect(list).toContain(c);
    expect(list).toContain('New');

    const detail = (await say(PHONE, `order ${c.toLowerCase()}`)).at(-1);
    expect(detail).toContain('2 × Basmati Rice (1 kg)');
    expect(detail).toContain('[Accept]');

    expect((await say(PHONE, `accept ${c}`)).at(-1)).toContain('is now *Accepted*');
    expect(await orderStatus(order.id)).toBe('accepted');
    // "ready" steps through preparing.
    expect((await say(PHONE, `ready ${c}`)).at(-1)).toContain('Ready for pickup');
    expect(await orderStatus(order.id)).toBe('ready_for_pickup');
    expect((await say(PHONE, { replyId: `act:complete:${order.id}`, title: 'Mark completed' })).at(-1)).toContain('Completed');
    expect(await orderStatus(order.id)).toBe('completed');
  });

  it('asks before rejecting, and only rejects on Yes', async () => {
    const { shop, rice } = await linkedShop();
    const order = await orderFor(shop, rice);
    const ask = (await say(PHONE, `reject ${code(order.orderNumber)}`)).at(-1);
    expect(ask).toContain('Reject order');
    expect(ask).toContain('[Yes, reject]');
    expect(await orderStatus(order.id)).toBe('placed');

    expect((await say(PHONE, { replyId: `stop:reject:${order.id}`, title: 'Yes, reject' })).at(-1)).toContain('Rejected');
    expect(await orderStatus(order.id)).toBe('rejected');
  });

  it('refuses a step the order does not allow, with the reason', async () => {
    const { shop, rice } = await linkedShop();
    const order = await orderFor(shop, rice);
    expect((await say(PHONE, `done ${code(order.orderNumber)}`)).at(-1)).toContain('cannot be changed that way');
    expect(await orderStatus(order.id)).toBe('placed');
  });

  it("never touches another shop's order, even with its id in a button", async () => {
    const { shop } = await linkedShop();
    const other = await flow.openShop({ name: 'Other Shop' });
    await flow.publish(other);
    const otherRice = await flow.addRice(other);
    const order = await orderFor(other, otherRice);
    expect((await say(PHONE, { replyId: `act:accept:${order.id}`, title: 'Accept' })).at(-1)).toContain("couldn't find that order");
    expect(await orderStatus(order.id)).toBe('placed');
    expect(shop.store.id).not.toBe(other.store.id);
  });

  it('handles a message WhatsApp delivers twice only once', async () => {
    const { shop, rice } = await linkedShop();
    const order = await orderFor(shop, rice);
    const payload = metaPayload(PHONE, { text: `accept ${code(order.orderNumber)}` });
    await postWebhook(payload);
    await postWebhook(payload);
    const accepts = await sql(`select count(*)::int as n from whatsapp_messages where direction = 'out' and body like '%is now *Accepted*%'`);
    expect(accepts).toEqual([{ n: 1 }]);
  });
});

describe('sales, stock and the shop', () => {
  it("sums today's online orders and counter sales", async () => {
    const { shop, rice } = await linkedShop();
    const order = await orderFor(shop, rice, 1);
    const reply = (await say(PHONE, 'sales')).at(-1);
    expect(reply).toContain('*Today*');
    expect(reply).toContain('Online orders: 1');
    expect(reply).toContain(`₹${(order.totals?.totalPaise ?? order.totalPaise) / 100}`);
  });

  it('shows stock, what is low, and adds received stock after a confirm', async () => {
    const { rice } = await linkedShop();
    const stock = (await say(PHONE, 'stock rice')).at(-1);
    expect(stock).toContain('Basmati Rice (1 kg): *20* can sell');
    expect((await say(PHONE, 'low stock')).at(-1)).toContain('Basmati Rice (500 g): *4* left');

    // Two sizes match "rice": it asks which.
    const pick = (await say(PHONE, 'add 6 rice')).at(-1);
    expect(pick).toContain('Which one');
    expect((await sql('select quantity_on_hand as q from product_variants where id = $1', [rice.halfKg.id]))[0].q).toBe(4);

    expect((await say(PHONE, { replyId: `stockin:${rice.halfKg.id}:6`, title: 'Basmati Rice (500 g)' })).at(-1)).toContain('Added 6');
    expect((await sql('select quantity_on_hand as q from product_variants where id = $1', [rice.halfKg.id]))[0].q).toBe(10);
    const ledger = await sql(`select movement_type, on_hand_change, notes from inventory_ledger where variant_id = $1 order by created_at desc limit 1`, [rice.halfKg.id]);
    expect(ledger).toEqual([{ movement_type: 'stock_in', on_hand_change: 6, notes: 'Received (WhatsApp)' }]);
  });

  it('closes and reopens the shop for today', async () => {
    const { shop } = await linkedShop();
    expect((await say(PHONE, 'close today')).at(-1)).toContain('closed today');
    expect(await sql('select count(*)::int as n from store_holidays where store_id = $1', [shop.store.id])).toEqual([{ n: 1 }]);
    expect((await say(PHONE, 'open today')).at(-1)).toContain('open again');
    expect(await sql('select count(*)::int as n from store_holidays where store_id = $1', [shop.store.id])).toEqual([{ n: 0 }]);
  });

  it('answers anything else with the commands', async () => {
    await linkedShop();
    expect((await say(PHONE, 'what is the weather')).at(-1)).toContain("didn't understand");
    expect((await say(PHONE, 'hi')).at(-1)).toContain('*orders*');
  });

  it('a suspended account gets a notice and nothing else', async () => {
    const { shop, rice } = await linkedShop();
    const order = await orderFor(shop, rice);
    await sql(`update customers set suspended_at = now(), suspended_reason = 'test' where id = $1`, [shop.merchantId]);
    expect((await say(PHONE, `accept ${code(order.orderNumber)}`)).at(-1)).toContain('suspended');
    expect(await orderStatus(order.id)).toBe('placed');
  });

  it('unlink asks first, then stops the number', async () => {
    await linkedShop();
    expect((await say(PHONE, 'unlink')).at(-1)).toContain('[Yes, unlink]');
    expect((await say(PHONE, { replyId: 'unlink:yes', title: 'Yes, unlink' })).at(-1)).toContain('Unlinked');
    expect(await sql('select count(*)::int as n from merchant_whatsapp_links')).toEqual([{ n: 0 }]);
  });
});

describe('new-order alerts', () => {
  async function alerts() {
    return sql(`select body, status, error from whatsapp_messages where kind = 'order_alert' order by created_at`);
  }
  async function waitForAlert(n = 1) {
    for (let i = 0; i < 50; i += 1) {
      const rows = await alerts();
      if (rows.length >= n) return rows;
      await new Promise((r) => setTimeout(r, 20));
    }
    return alerts();
  }

  it('reaches the owner with Accept, Reject and View buttons', async () => {
    const { shop, rice } = await linkedShop();
    const order = await orderFor(shop, rice);
    const [alert] = await waitForAlert();
    expect(alert.body).toContain(`New order ${order.orderNumber}`);
    expect(alert.body).toContain('[Accept]');
    expect(alert.status).toBe('skipped'); // WHATSAPP_PROVIDER=none in tests
  });

  it('outside the 24-hour window, without a template, is recorded as skipped with the reason', async () => {
    const { shop, rice } = await linkedShop();
    await sql(`update merchant_whatsapp_links set last_inbound_at = now() - interval '2 days'`);
    await orderFor(shop, rice);
    const [alert] = await waitForAlert();
    expect(alert.error).toContain('24-hour window');
  });

  it('stays quiet when the owner turned alerts off', async () => {
    const { shop, rice } = await linkedShop();
    expectStatus(await call('patch', '/merchant/whatsapp', shop.merchant, { notifyOrders: false }), 200);
    await orderFor(shop, rice);
    await new Promise((r) => setTimeout(r, 200));
    expect(await alerts()).toEqual([]);
  });
});
