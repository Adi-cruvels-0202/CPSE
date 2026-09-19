import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { api, url } from './helpers/app.js';
import { ALWAYS_OPEN, addToCart, placeOrder } from './helpers/shopping.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin } = await import('../src/lib/supabase.js');
const { db, CUSTOMER_ID, STORE_ID, resetDb, seedCustomer, seedStore, seedCategory, seedProduct } =
  await import('./helpers/supabaseMock.js');
const { env } = await import('../src/config/env.js');

const OTHER_CUSTOMER_ID = '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e99';

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  seedCustomer();
  seedCustomer({ id: OTHER_CUSTOMER_ID, email: 'other@cpse.local' });
  seedStore({ opening_hours: ALWAYS_OPEN, min_order_paise: 19900 });
  seedCategory();
});

function signIn(id = CUSTOMER_ID) {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  return { Authorization: 'Bearer token-abc' };
}

/** Places an online order and initiates it, returning the provider reference. */
async function onlineOrder(auth, { initiate = true } = {}) {
  const product = seedProduct({ price_paise: 12500, stock: 50 });
  await addToCart(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });
  const { body } = await placeOrder(auth, { storeId: STORE_ID, paymentMethod: 'online' });
  const order = body.data.order;

  if (!initiate) return { order, providerRef: null };

  const { body: initiated } = await api()
    .post(url(`/payments/${order.id}/initiate`))
    .set(auth);

  return { order, providerRef: initiated.data.payment.providerRef };
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

describe('GET /api/v1/payments/methods (7.3)', () => {
  it('lists the platform payment methods without a token', async () => {
    const res = await api().get(url('/payments/methods'));

    expect(res.status).toBe(200);
    expect(res.body.data.methods.map((method) => method.code)).toEqual(['cash', 'online']);
    expect(res.body.data.methods[1]).toMatchObject({ requiresOnlineFlow: true });
  });
});

describe('POST /api/v1/payments/:orderId/initiate (7.10)', () => {
  it('returns the provider payload for the client', async () => {
    const auth = signIn();
    const { order } = await onlineOrder(auth, { initiate: false });

    const res = await api().post(url(`/payments/${order.id}/initiate`)).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.clientPayload).toMatchObject({
      provider: 'mock',
      amountPaise: 25000,
      currency: 'INR',
      isMockProvider: true,
    });
    expect(res.body.data.payment.providerRef).toMatch(/^mock_/);
    expect(res.body.data.payment.status).toBe('processing');
  });

  it('does not mark anything paid (7.13)', async () => {
    const auth = signIn();
    const { order } = await onlineOrder(auth);

    const { body } = await api().get(url(`/orders/${order.id}`)).set(auth);

    expect(body.data.order.status).toBe('pending_payment');
    expect(body.data.order.paymentStatus).toBe('pending');
  });

  it('refuses a cash order — there is nothing to initiate', async () => {
    const auth = signIn();
    const product = seedProduct({ price_paise: 25000, stock: 10 });
    await addToCart(auth, { storeId: STORE_ID, productId: product.id });
    const { body } = await placeOrder(auth, { storeId: STORE_ID });

    const res = await api().post(url(`/payments/${body.data.order.id}/initiate`)).set(auth);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOT_AN_ONLINE_ORDER');
  });

  it("404s for another customer's order", async () => {
    const auth = signIn();
    const { order } = await onlineOrder(auth, { initiate: false });

    const otherAuth = signIn(OTHER_CUSTOMER_ID);
    const res = await api().post(url(`/payments/${order.id}/initiate`)).set(otherAuth);

    expect(res.status).toBe(404);
  });

  it('requires a signed-in customer', async () => {
    const res = await api().post(url('/payments/01111111-1111-4111-8111-000000000001/initiate'));

    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/payments/:orderId/verify (7.12, 7.15)', () => {
  const verify = (auth, orderId, body = {}) =>
    api().post(url(`/payments/${orderId}/verify`)).set(auth).send(body);

  it('places the order once the provider confirms the payment', async () => {
    const auth = signIn();
    const { order } = await onlineOrder(auth);

    const res = await verify(auth, order.id, { outcome: 'success' });

    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe('paid');
    expect(res.body.data.payment.paidAt).toBeTruthy();
    // 7.15: the order follows the payment out of pending_payment.
    expect(res.body.data.order.status).toBe('placed');
    expect(res.body.data.order.paymentStatus).toBe('paid');
  });

  it('records the confirmation in the order timeline', async () => {
    const auth = signIn();
    const { order } = await onlineOrder(auth);

    const { body } = await verify(auth, order.id, { outcome: 'success' });

    const entries = body.data.order.timeline.history;
    expect(entries[entries.length - 1]).toMatchObject({
      toStatus: 'placed',
      changedBy: 'system',
      note: 'Payment confirmed',
    });
  });

  it('leaves a failed payment retryable rather than cancelling the order (7.15)', async () => {
    const auth = signIn();
    const { order } = await onlineOrder(auth);

    const { body } = await verify(auth, order.id, { outcome: 'failure' });

    expect(body.data.payment.status).toBe('failed');
    expect(body.data.payment.failureReason).toBeTruthy();
    expect(body.data.order.status).toBe('pending_payment');
    expect(body.data.order.paymentStatus).toBe('failed');
  });

  it('cancels the order when the customer abandons the payment (7.15)', async () => {
    const auth = signIn();
    const { order } = await onlineOrder(auth);

    const { body } = await verify(auth, order.id, { outcome: 'cancel' });

    expect(body.data.payment.status).toBe('cancelled');
    expect(body.data.order.status).toBe('cancelled');
  });

  it('keeps a pending payment pending, and the order unplaced', async () => {
    const auth = signIn();
    const { order } = await onlineOrder(auth);

    const { body } = await verify(auth, order.id, { outcome: 'pending' });

    expect(body.data.payment.status).toBe('processing');
    expect(body.data.order.status).toBe('pending_payment');
  });

  it('is idempotent once the payment has settled', async () => {
    const auth = signIn();
    const { order } = await onlineOrder(auth);
    await verify(auth, order.id, { outcome: 'success' });

    // A second, contradictory claim must not un-pay a paid order.
    const { body } = await verify(auth, order.id, { outcome: 'failure' });

    expect(body.data.payment.status).toBe('paid');
    expect(body.data.order.status).toBe('placed');
  });

  it('refuses a reference that belongs to a different payment', async () => {
    const auth = signIn();
    const { order } = await onlineOrder(auth);

    const res = await verify(auth, order.id, { providerRef: 'mock_somebody_else' });

    expect(res.status).toBe(400);
  });

  it("404s for another customer's order", async () => {
    const auth = signIn();
    const { order } = await onlineOrder(auth);

    const otherAuth = signIn(OTHER_CUSTOMER_ID);
    const res = await verify(otherAuth, order.id, { outcome: 'success' });

    expect(res.status).toBe(404);
  });

  it('rejects an unknown outcome', async () => {
    const auth = signIn();
    const { order } = await onlineOrder(auth);

    const res = await verify(auth, order.id, { outcome: 'definitely-paid-trust-me' });

    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/payments/webhook (7.11, 7.13)', () => {
  it('marks the order paid on a correctly signed success event', async () => {
    const auth = signIn();
    const { order, providerRef } = await onlineOrder(auth);

    const res = await signedWebhook({ event: 'success', providerRef, amountPaise: 25000 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ applied: true, status: 'paid' });

    const { body } = await api().get(url(`/orders/${order.id}`)).set(auth);
    expect(body.data.order.status).toBe('placed');
    expect(body.data.order.paymentStatus).toBe('paid');
    expect(body.data.order.timeline.history.at(-1).changedBy).toBe('payment_webhook');
  });

  it('rejects an unsigned webhook (7.13)', async () => {
    const auth = signIn();
    const { providerRef } = await onlineOrder(auth);

    const res = await api()
      .post(url('/payments/webhook'))
      .send({ event: 'success', providerRef, amountPaise: 25000 });

    expect(res.status).toBe(401);
    expect(db.tables.get('payments')[0].status).not.toBe('paid');
  });

  it('rejects a webhook signed with the wrong secret', async () => {
    const auth = signIn();
    const { providerRef } = await onlineOrder(auth);
    const body = { event: 'success', providerRef, amountPaise: 25000 };

    const res = await api()
      .post(url('/payments/webhook'))
      .set('Content-Type', 'application/json')
      .set(
        'X-CPSE-Signature',
        crypto.createHmac('sha256', 'not-the-secret').update(JSON.stringify(body)).digest('hex'),
      )
      .send(JSON.stringify(body));

    expect(res.status).toBe(401);
    expect(db.tables.get('payments')[0].status).not.toBe('paid');
  });

  it('rejects a tampered body whose signature no longer matches', async () => {
    const auth = signIn();
    const { providerRef } = await onlineOrder(auth);
    const signature = crypto
      .createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET)
      .update(JSON.stringify({ event: 'failure', providerRef }), 'utf8')
      .digest('hex');

    const res = await api()
      .post(url('/payments/webhook'))
      .set('Content-Type', 'application/json')
      .set('X-CPSE-Signature', signature)
      .send(JSON.stringify({ event: 'success', providerRef, amountPaise: 25000 }));

    expect(res.status).toBe(401);
  });

  it('applies a replayed webhook exactly once (7.11)', async () => {
    const auth = signIn();
    const { order, providerRef } = await onlineOrder(auth);
    const event = { event: 'success', providerRef, amountPaise: 25000 };

    const first = await signedWebhook(event);
    const second = await signedWebhook(event);
    const third = await signedWebhook(event);

    expect(first.body.data.applied).toBe(true);
    expect(second.body.data).toMatchObject({ applied: false, reason: 'ALREADY_SETTLED' });
    expect(third.body.data.applied).toBe(false);

    const { body } = await api().get(url(`/orders/${order.id}`)).set(auth);
    // One transition into 'placed', not three.
    const placedEntries = body.data.order.timeline.history.filter(
      (entry) => entry.toStatus === 'placed',
    );
    expect(placedEntries).toHaveLength(1);
  });

  it('ignores an event whose amount does not match the payment', async () => {
    const auth = signIn();
    const { order, providerRef } = await onlineOrder(auth);

    const res = await signedWebhook({ event: 'success', providerRef, amountPaise: 1 });

    expect(res.body.data).toMatchObject({ applied: false, reason: 'AMOUNT_MISMATCH' });
    const { body } = await api().get(url(`/orders/${order.id}`)).set(auth);
    expect(body.data.order.status).toBe('pending_payment');
  });

  it('acknowledges an unknown reference instead of erroring, so the gateway stops retrying', async () => {
    const res = await signedWebhook({ event: 'success', providerRef: 'mock_unknown_ref' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ applied: false, reason: 'UNKNOWN_REFERENCE' });
  });

  it('rejects an unknown event type', async () => {
    const auth = signIn();
    const { providerRef } = await onlineOrder(auth);

    const res = await signedWebhook({ event: 'refunded-maybe', providerRef });

    expect(res.status).toBe(400);
  });

  it('records a failure without touching the order status (7.15)', async () => {
    const auth = signIn();
    const { order, providerRef } = await onlineOrder(auth);

    const res = await signedWebhook({ event: 'failure', providerRef, amountPaise: 25000 });

    expect(res.body.data).toMatchObject({ applied: true, status: 'failed' });
    const { body } = await api().get(url(`/orders/${order.id}`)).set(auth);
    expect(body.data.order.status).toBe('pending_payment');
    expect(body.data.order.paymentStatus).toBe('failed');
  });

  it('needs no session — the gateway has none', async () => {
    const auth = signIn();
    const { providerRef } = await onlineOrder(auth);
    supabaseAdmin.auth.getUser.mockRejectedValue(new Error('should not be called'));

    const res = await signedWebhook({ event: 'success', providerRef, amountPaise: 25000 });

    expect(res.status).toBe(200);
  });
});

describe('what is stored (7.14)', () => {
  it('keeps no card, UPI or bank credential anywhere on the payment row', async () => {
    const auth = signIn();
    const { providerRef } = await onlineOrder(auth);
    await signedWebhook({ event: 'success', providerRef, amountPaise: 25000 });

    const payment = db.tables.get('payments')[0];
    const columns = Object.keys(payment);

    for (const forbidden of ['card_number', 'cvv', 'upi_id', 'account_number', 'token']) {
      expect(columns).not.toContain(forbidden);
    }
    // Only the provider's own reference and our amount are retained.
    expect(payment.provider_ref).toBe(providerRef);
    expect(payment.amount_paise).toBe(25000);
  });

  it('never returns the raw gateway payload to the client', async () => {
    const auth = signIn();
    const { order, providerRef } = await onlineOrder(auth);
    await signedWebhook({ event: 'success', providerRef, amountPaise: 25000 });

    const { body } = await api().get(url(`/orders/${order.id}`)).set(auth);

    expect(body.data.order.payment).not.toHaveProperty('rawPayload');
    expect(body.data.order.payment).not.toHaveProperty('raw_payload');
  });
});
