/**
 * Cancellation & refund settlement, against real Postgres (migrations 0036–0038).
 * Roadmap §4 P2 Cancellation & Refund Settlement, §5 P5 Refund Tracking Status,
 * §6 Cancellation & Refund flow, §7 Refund rule.
 *
 * The payment provider is the MOCK provider (simulated gateway). Nothing here
 * talks to a live payment service.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', async () => {
  const { createPgSupabase } = await import('../helpers/pgSupabase.js');
  return createPgSupabase();
});

const { resetDatabase, sql } = await import('../helpers/pgSupabase.js');
const { env } = await import('../../src/config/env.js');
const { sign } = await import('../../src/modules/payments/mock.provider.js');
const { reconcileRefunds } = await import('../../src/modules/refunds/refund.service.js');
const { api, url } = await import('../helpers/app.js');
const flow = await import('./flow.js');
const { call, expectStatus } = flow;

const originalMode = env.PAYMENT_MOCK_REFUND_MODE;
const originalSettle = env.PAYMENT_MOCK_REFUND_SETTLE_SECONDS;

beforeEach(async () => {
  await resetDatabase();
  env.PAYMENT_MOCK_REFUND_MODE = 'async';
  env.PAYMENT_MOCK_REFUND_SETTLE_SECONDS = 60;
});
afterEach(() => {
  env.PAYMENT_MOCK_REFUND_MODE = originalMode;
  env.PAYMENT_MOCK_REFUND_SETTLE_SECONDS = originalSettle;
});

function webhook(body) {
  const raw = JSON.stringify(body);
  return api().post(url('/payments/webhook')).set('Content-Type', 'application/json').set('X-CPSE-Signature', sign(raw)).send(raw);
}

/** A placed online order, paid through the mock gateway. */
async function paidOrder() {
  const shop = await flow.openShop();
  await flow.publish(shop);
  const rice = await flow.addRice(shop, { stock1kg: 10 });
  const customer = await flow.newCustomer();
  await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 2);
  const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id, paymentMethod: 'online' }), 201);
  expect(order.status).toBe('pending_payment');
  const paid = await flow.payOnline(customer, order.id);
  expect(paid.order).toMatchObject({ status: 'placed', paymentStatus: 'paid' });
  return { shop, customer, order: paid.order, rice };
}

const refundRows = (orderId) =>
  sql('select status, amount_paise, method, initiated_by, provider_refund_ref, payment_id from refunds where order_id = $1', [orderId]);

describe('a paid order that is cancelled is refunded, traceably', () => {
  it('customer cancels → refund initiated → processing → refunded by webhook; payment and order agree', async () => {
    const { customer, order } = await paidOrder();

    const cancelled = expectStatus(await call('post', `/orders/${order.id}/cancel`, customer.auth, { reason: 'Changed my mind' }), 200).order;
    expect(cancelled.status).toBe('cancelled');
    // Not yet refunded: the gateway has accepted it but not confirmed.
    expect(cancelled.paymentStatus).toBe('paid');
    expect(cancelled.refund).toMatchObject({
      status: 'processing',
      amountPaise: order.totalPaise,
      method: 'provider',
      initiatedBy: 'customer',
      isFinal: false,
    });
    expect(cancelled.refund.reference).toMatch(/^mock_rfnd_/);
    expect(cancelled.refund.events.map((e) => e.toStatus)).toEqual(['initiated', 'processing']);

    const [payment] = await sql('select id, status from payments where order_id = $1', [order.id]);
    const [refund] = await refundRows(order.id);
    expect(refund.payment_id).toBe(payment.id);
    expect(payment.status).toBe('paid');

    expectStatus(
      await webhook({ event: 'refund.processed', providerRefundRef: refund.provider_refund_ref, eventId: 'evt_1' }),
      200,
    );

    const after = expectStatus(await call('get', `/orders/${order.id}`, customer.auth), 200).order;
    expect(after.paymentStatus).toBe('refunded');
    expect(after.refund).toMatchObject({ status: 'refunded', isFinal: true });
    expect(after.refund.refundedAt).toBeTruthy();
    expect(after.refund.events.map((e) => e.toStatus)).toEqual(['initiated', 'processing', 'refunded']);
    expect((await sql('select status from payments where id = $1', [payment.id]))[0].status).toBe('refunded');

    const receipt = expectStatus(await call('get', `/orders/${order.id}/receipt`, customer.auth), 200).receipt;
    expect(receipt.refund).toMatchObject({ status: 'refunded', amountPaise: order.totalPaise });

    const types = (await sql('select type from notifications where customer_id = $1 order by created_at', [customer.id])).map((r) => r.type);
    expect(types).toEqual(expect.arrayContaining(['refund_initiated', 'refund_completed']));
  });

  it('a replayed or out-of-order webhook changes nothing and never refunds twice', async () => {
    const { customer, order } = await paidOrder();
    expectStatus(await call('post', `/orders/${order.id}/cancel`, customer.auth, {}), 200);
    const [refund] = await refundRows(order.id);

    const done = { event: 'refund.processed', providerRefundRef: refund.provider_refund_ref, eventId: 'evt_done' };
    expect(expectStatus(await webhook(done), 200).applied).toBe(true);
    const replay = expectStatus(await webhook(done), 200);
    expect(replay).toMatchObject({ applied: false, reason: 'DUPLICATE_EVENT' });

    const late = expectStatus(
      await webhook({ event: 'refund.processing', providerRefundRef: refund.provider_refund_ref, eventId: 'evt_late' }),
      200,
    );
    expect(late).toMatchObject({ applied: false, reason: 'STALE_EVENT', status: 'refunded' });
    const failedLate = expectStatus(
      await webhook({ event: 'refund.failed', providerRefundRef: refund.provider_refund_ref, eventId: 'evt_fail' }),
      200,
    );
    expect(failedLate.applied).toBe(false);

    expect(await refundRows(order.id)).toHaveLength(1);
    const completedNotices = await sql(
      `select count(*)::int as n from notifications where customer_id = $1 and type = 'refund_completed'`,
      [customer.id],
    );
    expect(completedNotices[0].n).toBe(1);
  });

  it('cancelling twice is refused and still leaves exactly one refund', async () => {
    const { customer, order } = await paidOrder();
    expectStatus(await call('post', `/orders/${order.id}/cancel`, customer.auth, {}), 200);
    const again = await call('post', `/orders/${order.id}/cancel`, customer.auth, {});
    expect(again.status).toBe(409);
    expect(await refundRows(order.id)).toHaveLength(1);
  });

  it('the database refuses a second live refund for the same payment', async () => {
    const { customer, order } = await paidOrder();
    expectStatus(await call('post', `/orders/${order.id}/cancel`, customer.auth, {}), 200);
    const [refund] = await refundRows(order.id);
    await expect(
      sql(
        `insert into refunds (order_id, payment_id, store_id, customer_id, amount_paise, method, provider, initiated_by)
         select order_id, payment_id, store_id, customer_id, amount_paise, method, provider, 'system' from refunds where payment_id = $1`,
        [refund.payment_id],
      ),
    ).rejects.toThrow(/refunds_one_live_cancellation_per_payment/);
  });

  it('the merchant rejecting a paid order refunds it, attributed to the store', async () => {
    const { shop, customer, order } = await paidOrder();
    expectStatus(
      await call('post', `/merchant/stores/${shop.store.id}/orders/${order.id}/reject`, shop.merchant, { reason: 'Out of stock' }),
      200,
    );
    const [refund] = await refundRows(order.id);
    expect(refund).toMatchObject({ initiated_by: 'store', method: 'provider', status: 'processing' });

    const merchantView = expectStatus(await call('get', `/merchant/stores/${shop.store.id}/orders/${order.id}`, shop.merchant), 200).order;
    expect(merchantView.refund).toMatchObject({ status: 'processing', amountPaise: order.totalPaise });

    const customerView = expectStatus(await call('get', `/orders/${order.id}`, customer.auth), 200).order;
    expect(customerView.refund.status).toBe(merchantView.refund.status);
  });

  it('the merchant cancelling a paid order after accepting it refunds it too', async () => {
    const { shop, order } = await paidOrder();
    const base = `/merchant/stores/${shop.store.id}/orders/${order.id}`;
    expectStatus(await call('post', `${base}/accept`, shop.merchant, {}), 200);
    expectStatus(await call('post', `${base}/cancel`, shop.merchant, { reason: 'Shop closing early' }), 200);
    expect(await refundRows(order.id)).toHaveLength(1);
  });
});

describe('when the refund fails', () => {
  it('records the failure, tells both sides, and the store can retry it once the partner works again', async () => {
    env.PAYMENT_MOCK_REFUND_MODE = 'fail';
    const { shop, customer, order } = await paidOrder();
    expectStatus(await call('post', `/orders/${order.id}/cancel`, customer.auth, {}), 200);

    const detail = expectStatus(await call('get', `/orders/${order.id}`, customer.auth), 200).order;
    expect(detail.refund).toMatchObject({ status: 'failed', failureReason: 'The payment partner declined the refund.' });
    // Money not returned, so the payment must still say paid — never refunded.
    expect(detail.paymentStatus).toBe('paid');

    const inbox = expectStatus(await call('get', `/merchant/stores/${shop.store.id}/notifications`, shop.merchant), 200);
    expect(inbox.notifications.map((n) => n.type)).toContain('refund_failed');

    const list = expectStatus(await call('get', `/merchant/stores/${shop.store.id}/refunds?status=failed`, shop.merchant), 200);
    expect(list.refunds).toHaveLength(1);
    expect(list.refunds[0].orderNumber).toBe(order.orderNumber);

    env.PAYMENT_MOCK_REFUND_MODE = 'async';
    const retried = expectStatus(
      await call('post', `/merchant/stores/${shop.store.id}/refunds/${list.refunds[0].id}/retry`, shop.merchant, {}),
      200,
    ).refund;
    expect(retried.status).toBe('processing');
    expect(retried.events.map((e) => e.toStatus)).toEqual(['initiated', 'failed', 'initiated', 'processing']);

    const retryAgain = await call('post', `/merchant/stores/${shop.store.id}/refunds/${list.refunds[0].id}/retry`, shop.merchant, {});
    expect(retryAgain.status).toBe(409);
  });

  it('another merchant cannot see or retry this store’s refunds', async () => {
    env.PAYMENT_MOCK_REFUND_MODE = 'fail';
    const { customer, order } = await paidOrder();
    expectStatus(await call('post', `/orders/${order.id}/cancel`, customer.auth, {}), 200);
    const [{ id }] = await sql('select id from refunds where order_id = $1', [order.id]);

    const other = await flow.openShop({ name: 'Other Shop' });
    expect((await call('get', `/merchant/stores/${other.store.id}/refunds/${id}`, other.merchant)).status).toBe(404);
    expect((await call('post', `/merchant/stores/${other.store.id}/refunds/${id}/retry`, other.merchant, {})).status).toBe(404);
  });
});

describe('reconciliation (the scheduled job)', () => {
  it('settles a processing refund once the partner reports it, without a webhook', async () => {
    const { customer, order } = await paidOrder();
    expectStatus(await call('post', `/orders/${order.id}/cancel`, customer.auth, {}), 200);

    expect(await reconcileRefunds()).toMatchObject({ settled: 0, stillProcessing: 1 });

    env.PAYMENT_MOCK_REFUND_SETTLE_SECONDS = 0;
    expect(await reconcileRefunds()).toMatchObject({ settled: 1 });
    const detail = expectStatus(await call('get', `/orders/${order.id}`, customer.auth), 200).order;
    expect(detail.refund.status).toBe('refunded');
    expect(detail.refund.events.at(-1).source).toBe('reconciliation');

    // Running it again is a no-op.
    expect(await reconcileRefunds()).toMatchObject({ settled: 0, sent: 0 });
  });
});

describe('payments that arrive out of order', () => {
  it('a payment confirmed after the order was cancelled is refunded automatically', async () => {
    const shop = await flow.openShop();
    await flow.publish(shop);
    const rice = await flow.addRice(shop);
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id, paymentMethod: 'online' }), 201);
    const { payment } = expectStatus(await call('post', `/payments/${order.id}/initiate`, customer.auth, {}), 200);

    // The customer gives up while the gateway is still working.
    expectStatus(await call('post', `/orders/${order.id}/cancel`, customer.auth, {}), 200);
    expect(await refundRows(order.id)).toHaveLength(0);

    expectStatus(await webhook({ event: 'success', providerRef: payment.providerRef, amountPaise: order.totalPaise }), 200);

    const detail = expectStatus(await call('get', `/orders/${order.id}`, customer.auth), 200).order;
    expect(detail.status).toBe('cancelled');
    expect(detail.refund).toMatchObject({ status: 'processing', initiatedBy: 'payment_webhook', amountPaise: order.totalPaise });
  });

  it('refuses to start a payment for an order that is no longer waiting for one', async () => {
    const { customer, order } = await paidOrder();
    expectStatus(await call('post', `/orders/${order.id}/cancel`, customer.auth, {}), 200);
    expect((await call('post', `/payments/${order.id}/initiate`, customer.auth, {})).status).toBe(409);
  });
});

describe('cash orders', () => {
  it('are marked paid, with a cash payment record, when the merchant completes them', async () => {
    const shop = await flow.openShop();
    await flow.publish(shop);
    const rice = await flow.addRice(shop);
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    expect(order).toMatchObject({ paymentMethod: 'cash', paymentStatus: 'pending' });

    await flow.fulfil(shop, order.id);
    const detail = expectStatus(await call('get', `/orders/${order.id}`, customer.auth), 200).order;
    expect(detail.paymentStatus).toBe('paid');
    expect(detail.payment).toMatchObject({ provider: 'cash', status: 'paid', amountPaise: order.totalPaise });
    const receipt = expectStatus(await call('get', `/orders/${order.id}/receipt`, customer.auth), 200).receipt;
    expect(receipt.payment).toMatchObject({ method: 'cash', status: 'paid' });
  });

  it('cancelled before collection: nothing was paid, nothing is refunded', async () => {
    const shop = await flow.openShop();
    await flow.publish(shop);
    const rice = await flow.addRice(shop);
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    expect(order.cancellation).toMatchObject({ isCancellable: true, refundOnCancelPaise: 0 });

    const cancelled = expectStatus(await call('post', `/orders/${order.id}/cancel`, customer.auth, {}), 200).order;
    expect(cancelled.paymentStatus).toBe('cancelled');
    expect(cancelled.refund).toBeNull();
    expect(await refundRows(order.id)).toHaveLength(0);
  });
});

describe('refund records are audit-safe', () => {
  it('refund events cannot be edited or deleted', async () => {
    const { customer, order } = await paidOrder();
    expectStatus(await call('post', `/orders/${order.id}/cancel`, customer.auth, {}), 200);
    await expect(sql(`update refund_events set note = 'x'`)).rejects.toThrow(/immutable/);
    await expect(sql(`delete from refund_events`)).rejects.toThrow(/immutable/);
  });

  it('a refunded refund cannot be marked failed afterwards, even directly through the function', async () => {
    const { customer, order } = await paidOrder();
    expectStatus(await call('post', `/orders/${order.id}/cancel`, customer.auth, {}), 200);
    const [{ id }] = await sql('select id from refunds where order_id = $1', [order.id]);
    await sql(`select record_refund_update($1::jsonb)`, [JSON.stringify({ refund_id: id, to_status: 'refunded', source: 'system' })]);
    const [{ result }] = await sql(`select record_refund_update($1::jsonb) as result`, [
      JSON.stringify({ refund_id: id, to_status: 'failed', source: 'system', failure_reason: 'x' }),
    ]);
    expect(result).toMatchObject({ applied: false, reason: 'STALE_EVENT', status: 'refunded' });
  });
});
