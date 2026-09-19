import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, notFound, conflict, unprocessable } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { paymentProvider } from './provider.js';
import { findOwnedOrder, transitionOrder, getOrder } from '../orders/order.service.js';
import { orderStatusForPayment } from '../orders/order.state.js';
import * as notifications from '../notifications/notification.service.js';

/**
 * Payments — checklist 7.10 – 7.16.
 *
 * Two rules the whole module is built around:
 *
 *  - An order is never marked paid on a client's say-so (7.13). Only a
 *    provider answer — a verified webhook or a provider-side verification —
 *    writes `paid`.
 *  - No card, UPI handle or bank credential is ever stored (7.14). The portal
 *    holds the provider's reference and its own amount, nothing else. The raw
 *    payload column keeps the gateway's response for reconciliation, and the
 *    gateway does not put instrument details in it.
 */

const fail = (error, message) => {
  if (error) throw internal(message);
};

const PAYMENT_COLUMNS = `
  id, order_id, provider, provider_ref, amount_paise, currency, status,
  failure_reason, paid_at, created_at, updated_at
`;

/** Terminal payment states — a webhook replay must not move them (7.11). */
const SETTLED = ['paid', 'refunded', 'cancelled'];

async function findPaymentForOrder(orderId) {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1);

  fail(error, 'Could not load the payment.');
  return (data ?? [])[0] ?? null;
}

async function findPaymentByRef(provider, providerRef) {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .eq('provider', provider)
    .eq('provider_ref', providerRef)
    .maybeSingle();

  fail(error, 'Could not load the payment.');
  return data ?? null;
}

async function updatePayment(paymentId, patch) {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .update(patch)
    .eq('id', paymentId)
    .select(PAYMENT_COLUMNS)
    .maybeSingle();

  fail(error, 'Could not update the payment.');
  if (!data) throw notFound('Payment');
  return data;
}

/**
 * Checklist 7.10. Opens (or reopens) an attempt and hands the client whatever
 * the gateway needs. Nothing here decides an outcome.
 */
export async function initiatePayment(customerId, orderId) {
  const order = await findOwnedOrder(customerId, orderId);
  const payment = await findPaymentForOrder(order.id);

  // A cash order has no payment row; there is nothing to initiate.
  if (!payment) {
    throw unprocessable('NOT_AN_ONLINE_ORDER', 'This order is not being paid for online.');
  }
  if (SETTLED.includes(payment.status)) {
    throw conflict('This payment has already been settled.');
  }

  const provider = paymentProvider(payment.provider);
  const result = provider.initiate({ order, payment });

  const updated = await updatePayment(payment.id, {
    provider_ref: result.providerRef,
    status: result.status ?? 'processing',
  });

  return { payment: toPublicPaymentRow(updated), clientPayload: result.clientPayload };
}

/**
 * Checklist 7.12. The browser comes back from the gateway and we ask the
 * provider what happened. The client's claim is only a prompt to check.
 */
export async function verifyPayment(customerId, orderId, input) {
  const order = await findOwnedOrder(customerId, orderId);
  const payment = await findPaymentForOrder(order.id);

  if (!payment) {
    throw unprocessable('NOT_AN_ONLINE_ORDER', 'This order is not being paid for online.');
  }

  // Already settled: answer with the settled state rather than re-applying it.
  if (SETTLED.includes(payment.status)) {
    return { order: await getOrder(customerId, order.id), payment: toPublicPaymentRow(payment) };
  }

  const provider = paymentProvider(payment.provider);
  const outcome = provider.verify({ order, payment, input });

  const updated = await applyOutcome(order, payment, outcome, 'system');

  return { order: await getOrder(customerId, order.id), payment: toPublicPaymentRow(updated) };
}

/**
 * Checklist 7.11. Signature-verified by the provider, and idempotent: a
 * gateway that delivers the same event three times must produce one state
 * change, not three.
 */
export async function handleWebhook({ rawBody, signature, body, providerName }) {
  const provider = paymentProvider(providerName);
  const event = provider.handleWebhook({ rawBody, signature, body });

  const payment = await findPaymentByRef(providerName, event.providerRef);
  // An unknown reference is acknowledged, not errored: a gateway that gets a
  // 4xx will retry forever, and there is nothing here to retry into.
  if (!payment) {
    logger.warn('Webhook for an unknown payment reference', { providerRef: event.providerRef });
    return { applied: false, reason: 'UNKNOWN_REFERENCE' };
  }

  if (SETTLED.includes(payment.status)) {
    // The replay case. Already settled, so there is nothing to do.
    return { applied: false, reason: 'ALREADY_SETTLED', status: payment.status };
  }

  // A mismatched amount means the event is not about this order as we know it.
  if (event.amountPaise !== null && event.amountPaise !== payment.amount_paise) {
    logger.error('Webhook amount does not match the payment', {
      providerRef: event.providerRef,
      expected: payment.amount_paise,
      received: event.amountPaise,
    });
    return { applied: false, reason: 'AMOUNT_MISMATCH' };
  }

  const { data: orderRow, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, status, payment_status, customer_id')
    .eq('id', payment.order_id)
    .maybeSingle();

  fail(error, 'Could not load the order.');
  if (!orderRow) return { applied: false, reason: 'UNKNOWN_ORDER' };

  await applyOutcome(orderRow, payment, event, 'payment_webhook');
  return { applied: true, status: event.status };
}

/**
 * Checklist 7.15. The one place a payment result touches an order, so the two
 * states can never disagree:
 *
 *   paid      → the order leaves pending_payment and becomes placed
 *   cancelled → the order is cancelled
 *   failed    → the order stays where it is, so the customer can try again
 */
async function applyOutcome(orderRow, payment, outcome, changedBy) {
  const updated = await updatePayment(payment.id, {
    status: outcome.status,
    provider_ref: outcome.providerRef ?? payment.provider_ref,
    failure_reason: outcome.failureReason ?? null,
    paid_at: outcome.status === 'paid' ? new Date().toISOString() : null,
    raw_payload: outcome.raw ?? {},
  });

  const nextOrderStatus = orderStatusForPayment(orderRow.status, outcome.status);

  // Checklist 9.3. The payment notification is emitted whether or not the order
  // status moves: a failed payment leaves the order where it is, and that is
  // precisely the case the customer has to be told about so they can retry.
  await notifications.notifyPaymentOutcome(orderRow, outcome.status, {
    failureReason: outcome.failureReason ?? null,
  });

  if (nextOrderStatus) {
    await transitionOrder(orderRow, nextOrderStatus, {
      changedBy,
      note: outcome.status === 'paid' ? 'Payment confirmed' : 'Payment cancelled',
      patch: { payment_status: outcome.status },
    });
  } else {
    // No status change, but the order's payment_status must still follow.
    const { error } = await supabaseAdmin
      .from('orders')
      .update({ payment_status: outcome.status })
      .eq('id', orderRow.id);

    fail(error, 'Could not update the order payment status.');
  }

  return updated;
}

export const toPublicPaymentRow = (row) => ({
  id: row.id,
  orderId: row.order_id,
  provider: row.provider,
  providerRef: row.provider_ref ?? null,
  amountPaise: row.amount_paise,
  currency: row.currency,
  status: row.status,
  failureReason: row.failure_reason ?? null,
  paidAt: row.paid_at ?? null,
});
