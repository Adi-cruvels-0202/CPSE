import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { api, url } from './helpers/app.js';
import { ALWAYS_OPEN, addToCart, placeOrder, advance } from './helpers/shopping.js';

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
  seedNotification,
} = await import('./helpers/supabaseMock.js');
const { env } = await import('../src/config/env.js');

const OTHER_CUSTOMER_ID = '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e99';

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  seedCustomer();
  seedCustomer({ id: OTHER_CUSTOMER_ID, email: 'other@cpse.local' });
  seedStore({ opening_hours: ALWAYS_OPEN, min_order_paise: 0 });
  seedCategory();
});

function signIn(id = CUSTOMER_ID) {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  return { Authorization: 'Bearer token-abc' };
}

const rows = () => db.tables.get('notifications') ?? [];
const typesFor = (customerId = CUSTOMER_ID) =>
  rows().filter((row) => row.customer_id === customerId).map((row) => row.type);

const list = (auth, query = '') => api().get(url(`/notifications${query}`)).set(auth);

/** A cash order, placed. */
async function cashOrder(auth) {
  const product = seedProduct({ price_paise: 12500, stock: 50 });
  await addToCart(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });
  const { body } = await placeOrder(auth, { storeId: STORE_ID });
  return body.data.order;
}

async function onlineOrder(auth) {
  const product = seedProduct({ price_paise: 12500, stock: 50 });
  await addToCart(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });
  const { body } = await placeOrder(auth, { storeId: STORE_ID, paymentMethod: 'online' });
  const { body: initiated } = await api().post(url(`/payments/${body.data.order.id}/initiate`)).set(auth);
  return { order: body.data.order, providerRef: initiated.data.payment.providerRef };
}

const signedWebhook = (body) => {
  const raw = JSON.stringify(body);
  const signature = crypto
    .createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET)
    .update(raw, 'utf8')
    .digest('hex');

  return api()
    .post(url('/payments/webhook'))
    .set('Content-Type', 'application/json')
    .set('X-CPSE-Signature', signature)
    .send(raw);
};

describe('emission on order state changes (9.3)', () => {
  it('notifies the customer when a cash order is placed', async () => {
    const auth = signIn();

    const order = await cashOrder(auth);

    expect(typesFor()).toContain('order_placed');
    const notification = rows().find((row) => row.type === 'order_placed');
    expect(notification.title).toContain(order.orderNumber);
    expect(notification.payload).toMatchObject({ order_id: order.id, store_id: STORE_ID });
    // Arrives unread — the column defaults to null, so the public shape is what
    // this asserts rather than the raw row.
    expect((await list(auth)).body.data.notifications[0]).toMatchObject({
      type: 'order_placed',
      isRead: false,
      readAt: null,
    });
  });

  it('notifies on every merchant status move, once each', async () => {
    const auth = signIn();
    const order = await cashOrder(auth);

    await advance(auth, order.id, 'accepted');
    await advance(auth, order.id, 'preparing');
    await advance(auth, order.id, 'ready_for_pickup');

    const statuses = rows()
      .filter((row) => row.type === 'order_status_changed')
      .map((row) => row.payload.status);

    expect(statuses).toEqual(['accepted', 'preparing', 'ready_for_pickup']);
  });

  it('uses the order_cancelled type when the customer cancels', async () => {
    const auth = signIn();
    const order = await cashOrder(auth);

    await api().post(url(`/orders/${order.id}/cancel`)).set(auth).send({ reason: 'Changed my mind' });

    const cancelled = rows().find((row) => row.type === 'order_cancelled');
    expect(cancelled).toBeDefined();
    expect(cancelled.payload.status).toBe('cancelled');
    // The customer's own reason is echoed back to them.
    expect(cancelled.body).toBe('Changed my mind');
  });

  it('does not notify twice for a replayed Idempotency-Key', async () => {
    const auth = signIn();
    const product = seedProduct({ price_paise: 12500, stock: 50 });
    await addToCart(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });

    await placeOrder(auth, { storeId: STORE_ID }, { idempotencyKey: 'key-1' });
    await placeOrder(auth, { storeId: STORE_ID }, { idempotencyKey: 'key-1' });

    expect(typesFor().filter((type) => type === 'order_placed')).toHaveLength(1);
  });

  it('says nothing while an online order is still awaiting payment', async () => {
    const auth = signIn();

    await onlineOrder(auth);

    // pending_payment is the screen the customer is already looking at.
    expect(typesFor()).not.toContain('order_placed');
    expect(typesFor()).not.toContain('order_status_changed');
  });

  it('notifies the payment, not a duplicate "placed", when the gateway confirms', async () => {
    const auth = signIn();
    const { order, providerRef } = await onlineOrder(auth);

    await signedWebhook({ event: 'success', providerRef, amountPaise: order.totals.totalPaise });

    expect(typesFor()).toContain('payment_succeeded');
    // The payment notification already tells them the order is through.
    expect(typesFor().filter((type) => type === 'order_status_changed')).toHaveLength(0);
  });

  it('notifies a failed payment, with the provider’s reason, so the customer can retry', async () => {
    const auth = signIn();
    const { providerRef } = await onlineOrder(auth);

    await signedWebhook({ event: 'failure', providerRef, failureReason: 'Declined by issuer' });

    const failed = rows().find((row) => row.type === 'payment_failed');
    expect(failed).toBeDefined();
    expect(failed.body).toBe('Declined by issuer');
  });

  it('notifies the right customer only', async () => {
    await cashOrder(signIn());

    expect(typesFor(CUSTOMER_ID)).toContain('order_placed');
    expect(typesFor(OTHER_CUSTOMER_ID)).toEqual([]);
  });

  it('never carries a price, an address or a phone number in the payload', async () => {
    const auth = signIn();
    const order = await cashOrder(auth);
    await advance(auth, order.id, 'accepted');

    for (const row of rows()) {
      const payload = JSON.stringify(row.payload);
      expect(payload).not.toMatch(/paise|phone|line1|postal/i);
      expect(Object.keys(row.payload).sort()).toEqual(
        expect.arrayContaining(['order_id', 'order_number']),
      );
    }
  });

  it('does not fail the order when the notification insert fails', async () => {
    const auth = signIn();
    const product = seedProduct({ price_paise: 12500, stock: 50 });
    await addToCart(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });

    db.failNextInsert = { message: 'notifications table is on fire', code: '42P01' };

    const res = await placeOrder(auth, { storeId: STORE_ID });

    // The order is what the customer paid attention to; a lost notification
    // must never undo it.
    expect(res.status).toBe(201);
    expect(res.body.data.order.status).toBe('placed');
  });
});

describe('GET /api/v1/notifications (9.4)', () => {
  it('requires a signed-in customer', async () => {
    const res = await api().get(url('/notifications'));

    expect(res.status).toBe(401);
  });

  it('returns own notifications, newest first, with the unread count', async () => {
    const auth = signIn();
    seedNotification({ title: 'Older', created_at: '2026-09-01T10:00:00.000Z' });
    seedNotification({ title: 'Newer', created_at: '2026-09-18T10:00:00.000Z' });

    const res = await list(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.notifications.map((n) => n.title)).toEqual(['Newer', 'Older']);
    expect(res.body.data.unreadCount).toBe(2);
    expect(res.body.meta).toMatchObject({ page: 1, total: 2 });
  });

  it('shapes a notification for the client', async () => {
    const auth = signIn();
    seedNotification({ type: 'order_placed', payload: { order_id: 'abc' } });

    const [notification] = (await list(auth)).body.data.notifications;

    expect(notification).toMatchObject({
      type: 'order_placed',
      payload: { order_id: 'abc' },
      isRead: false,
      readAt: null,
    });
    expect(notification.customerId).toBeUndefined();
  });

  it('never returns another customer’s notifications (9.4)', async () => {
    seedNotification({ customer_id: OTHER_CUSTOMER_ID, title: 'Not yours' });

    const res = await list(signIn());

    expect(res.body.data.notifications).toEqual([]);
    expect(res.body.data.unreadCount).toBe(0);
  });

  it('filters to unread only', async () => {
    const auth = signIn();
    seedNotification({ title: 'Read one', read_at: '2026-09-18T11:00:00.000Z' });
    seedNotification({ title: 'Unread one' });

    const all = await list(auth);
    const unread = await list(auth, '?unreadOnly=true');

    expect(all.body.data.notifications).toHaveLength(2);
    expect(unread.body.data.notifications.map((n) => n.title)).toEqual(['Unread one']);
  });

  it('paginates and caps the page size', async () => {
    const auth = signIn();
    seedNotification({ created_at: '2026-09-01T10:00:00.000Z' });
    seedNotification({ created_at: '2026-09-02T10:00:00.000Z' });

    const page1 = await list(auth, '?page=1&limit=1');
    expect(page1.body.data.notifications).toHaveLength(1);
    expect(page1.body.meta).toMatchObject({ total: 2, hasNextPage: true });

    expect((await list(auth, '?limit=500')).status).toBe(422);
  });

  it('rejects an unknown query parameter', async () => {
    expect((await list(signIn(), '?type=order_placed')).status).toBe(422);
  });
});

describe('GET /api/v1/notifications/unread-count (9.4)', () => {
  it('counts only this customer’s unread rows', async () => {
    const auth = signIn();
    seedNotification();
    seedNotification({ read_at: '2026-09-18T11:00:00.000Z' });
    seedNotification({ customer_id: OTHER_CUSTOMER_ID });

    const res = await api().get(url('/notifications/unread-count')).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.unreadCount).toBe(1);
  });

  it('requires a signed-in customer', async () => {
    expect((await api().get(url('/notifications/unread-count'))).status).toBe(401);
  });
});

describe('POST /api/v1/notifications/:id/read (9.5)', () => {
  it('marks one notification read', async () => {
    const auth = signIn();
    const row = seedNotification();

    const res = await api().post(url(`/notifications/${row.id}/read`)).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.notification).toMatchObject({ id: row.id, isRead: true });
    expect(res.body.data.notification.readAt).toBeTruthy();
  });

  it('is idempotent and keeps the original read time', async () => {
    const auth = signIn();
    const row = seedNotification({ read_at: '2026-09-18T11:00:00.000Z' });

    const res = await api().post(url(`/notifications/${row.id}/read`)).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.notification.readAt).toBe('2026-09-18T11:00:00.000Z');
  });

  it('404s for another customer’s notification, never 403 (9.4)', async () => {
    const row = seedNotification({ customer_id: OTHER_CUSTOMER_ID });

    const res = await api().post(url(`/notifications/${row.id}/read`)).set(signIn());

    expect(res.status).toBe(404);
    // And it is still unread for its owner.
    expect(rows().find((r) => r.id === row.id).read_at).toBeNull();
  });

  it('404s for a notification that does not exist', async () => {
    const res = await api()
      .post(url('/notifications/9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0eff/read'))
      .set(signIn());

    expect(res.status).toBe(404);
  });

  it('422s on an id that is not a uuid', async () => {
    expect((await api().post(url('/notifications/nope/read')).set(signIn())).status).toBe(422);
  });

  it('requires a signed-in customer', async () => {
    const row = seedNotification();

    expect((await api().post(url(`/notifications/${row.id}/read`))).status).toBe(401);
  });
});

describe('POST /api/v1/notifications/read-all (9.5)', () => {
  it('marks every unread notification read and reports how many moved', async () => {
    const auth = signIn();
    seedNotification();
    seedNotification();
    seedNotification({ read_at: '2026-09-18T11:00:00.000Z' });

    const res = await api().post(url('/notifications/read-all')).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ updated: 2, unreadCount: 0 });
    expect((await list(auth)).body.data.unreadCount).toBe(0);
  });

  it('leaves another customer’s notifications unread', async () => {
    const mine = seedNotification();
    const theirs = seedNotification({ customer_id: OTHER_CUSTOMER_ID });

    await api().post(url('/notifications/read-all')).set(signIn());

    expect(rows().find((r) => r.id === mine.id).read_at).toBeTruthy();
    expect(rows().find((r) => r.id === theirs.id).read_at).toBeNull();
  });

  it('succeeds with nothing to do', async () => {
    const res = await api().post(url('/notifications/read-all')).set(signIn());

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(0);
  });

  it('is not read as a notification id', async () => {
    // Would be a 422 (not a uuid) if the route order were wrong.
    const res = await api().post(url('/notifications/read-all')).set(signIn());

    expect(res.status).toBe(200);
  });
});

describe('a client cannot manufacture a notification (9.3)', () => {
  it('has no create endpoint', async () => {
    const res = await api()
      .post(url('/notifications'))
      .set(signIn())
      .send({ type: 'order_placed', title: 'Free stuff' });

    expect(res.status).toBe(404);
    expect(rows()).toHaveLength(0);
  });

  it('refuses a PATCH on a notification', async () => {
    const row = seedNotification();

    const res = await api()
      .patch(url(`/notifications/${row.id}`))
      .set(signIn())
      .send({ title: 'Rewritten' });

    expect(res.status).toBe(404);
    expect(rows()[0].title).toBe(row.title);
  });

  it('refuses a DELETE on a notification', async () => {
    const row = seedNotification();

    const res = await api().delete(url(`/notifications/${row.id}`)).set(signIn());

    expect(res.status).toBe(404);
    expect(rows()).toHaveLength(1);
  });
});
