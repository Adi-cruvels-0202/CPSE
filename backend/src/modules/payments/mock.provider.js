import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { badRequest, unauthorized } from '../../lib/errors.js';

/**
 * Mock payment provider — checklist 7.2, decision D7.
 *
 * No real gateway is available yet, so this stands in for one. It is a real
 * implementation of the interface, not a stub: it mints provider references,
 * signs and verifies webhooks with HMAC-SHA256 exactly as a gateway would, and
 * can produce all four outcomes (success, failure, cancel, pending) so the
 * order lifecycle can be exercised end to end.
 *
 * Refunds follow a real gateway's shape too: creating one is idempotent on our
 * refund id, answers 'processing', and the final word arrives later — through
 * a signed `refund.processed` / `refund.failed` webhook or a status lookup. It
 * never says 'refunded' on the spot, because no real gateway does.
 *
 * What it deliberately does NOT do is touch card data. The portal never sees a
 * card number, so there is nothing to store (checklist 7.14).
 */

export const NAME = 'mock';

/** Checklist 7.3 */
export function methods() {
  return [
    {
      code: 'cash',
      label: 'Cash on pickup / delivery',
      description: 'Pay the store directly when you collect or receive your order.',
      requiresOnlineFlow: false,
    },
    {
      code: 'online',
      label: 'Pay online',
      description: 'Card, UPI or net banking through our payment partner.',
      requiresOnlineFlow: true,
    },
  ];
}

const reference = () => `mock_${crypto.randomBytes(12).toString('hex')}`;

/**
 * Checklist 7.10. Returns the payload the browser would hand to a gateway SDK.
 * `checkoutUrl` is where a real provider would host its payment page; here it
 * is the endpoint the frontend can POST back to in development.
 */
export function initiate({ order, payment }) {
  const providerRef = payment.provider_ref ?? reference();

  return {
    providerRef,
    status: 'processing',
    clientPayload: {
      provider: NAME,
      providerRef,
      amountPaise: payment.amount_paise,
      currency: payment.currency,
      orderNumber: order.order_number,
      // Clearly marked: a real gateway would redirect the customer here.
      checkoutUrl: `${env.PAYMENT_MOCK_CHECKOUT_URL}?ref=${providerRef}`,
      isMockProvider: true,
    },
  };
}

const OUTCOMES = new Set(['success', 'failure', 'cancel', 'pending']);

const STATUS_BY_OUTCOME = {
  success: 'paid',
  failure: 'failed',
  cancel: 'cancelled',
  pending: 'processing',
};

/**
 * Checklist 7.12. A real provider would call its API with the reference and
 * believe only the answer. The mock takes the outcome as an input because
 * there is no gateway to ask — which is exactly the part that changes when a
 * real provider is dropped in.
 */
export function verify({ payment, input = {} }) {
  const outcome = input.outcome ?? 'success';
  if (!OUTCOMES.has(outcome)) throw badRequest('Unknown payment outcome.');

  if (input.providerRef && payment.provider_ref && input.providerRef !== payment.provider_ref) {
    throw badRequest('This payment reference belongs to a different payment.');
  }

  return {
    providerRef: payment.provider_ref ?? input.providerRef ?? reference(),
    status: STATUS_BY_OUTCOME[outcome],
    failureReason: outcome === 'failure' ? 'The payment was declined by the issuer.' : null,
    raw: { provider: NAME, outcome, verifiedAt: new Date().toISOString() },
  };
}

// ── Refunds ─────────────────────────────────────────────────────────────────

/**
 * The refund reference carries the moment it was created and our refund id,
 * so the mock can answer a status lookup after a restart without keeping
 * state — and so a retry for the same refund gets the same reference back,
 * which is what makes creating it idempotent.
 */
const refundReference = (refundId, createdAtMs) =>
  `mock_rfnd_${createdAtMs}_${crypto.createHash('sha256').update(refundId).digest('hex').slice(0, 16)}`;

const createdRefunds = new Map();

/**
 * Asks the gateway to return `refund.amount_paise` of `payment`. Idempotent on
 * `refund.id`: asking twice creates one refund.
 *
 *   -> { status: 'processing' | 'failed', providerRefundRef, failureReason, raw }
 */
export function refund({ payment, refund: refundRow }) {
  if (!payment.provider_ref) {
    return {
      status: 'failed',
      providerRefundRef: null,
      failureReason: 'The original payment has no gateway reference to refund against.',
      raw: { provider: NAME },
    };
  }
  if (env.PAYMENT_MOCK_REFUND_MODE === 'fail') {
    return {
      status: 'failed',
      providerRefundRef: null,
      failureReason: 'The payment partner declined the refund.',
      raw: { provider: NAME, mode: 'fail' },
    };
  }

  let ref = createdRefunds.get(refundRow.id);
  if (!ref) {
    ref = refundReference(refundRow.id, Date.now());
    createdRefunds.set(refundRow.id, ref);
  }
  return {
    status: 'processing',
    providerRefundRef: ref,
    failureReason: null,
    raw: { provider: NAME, paymentRef: payment.provider_ref, amountPaise: refundRow.amount_paise },
  };
}

/**
 * The status of a refund the gateway already holds — the reconciliation path.
 * A mock refund settles once PAYMENT_MOCK_REFUND_SETTLE_SECONDS have passed
 * since it was created.
 */
export function fetchRefund({ providerRefundRef, now = Date.now() }) {
  const match = /^mock_rfnd_(\d+)_[0-9a-f]+$/.exec(providerRefundRef ?? '');
  if (!match) return { status: 'unknown', raw: { provider: NAME } };
  const ageSeconds = (now - Number(match[1])) / 1000;
  return {
    status: ageSeconds >= env.PAYMENT_MOCK_REFUND_SETTLE_SECONDS ? 'refunded' : 'processing',
    raw: { provider: NAME, checkedAt: new Date(now).toISOString() },
  };
}

// ── Webhooks ────────────────────────────────────────────────────────────────

/** The signature a gateway would send alongside the webhook body. */
export function sign(rawBody) {
  return crypto
    .createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET)
    .update(rawBody, 'utf8')
    .digest('hex');
}

const REFUND_STATUS_BY_EVENT = {
  'refund.processing': 'processing',
  'refund.processed': 'refunded',
  'refund.failed': 'failed',
};

/**
 * Checklist 7.11. Rejects anything whose signature does not match, so an
 * attacker who knows an order number still cannot mark it paid — or refunded.
 * Compared in constant time, because a fast reject leaks the signature one
 * byte at a time.
 *
 * Returns a payment event `{ kind: 'payment', providerRef, status, ... }` or a
 * refund event `{ kind: 'refund', providerRefundRef, status, eventId, ... }`.
 */
export function handleWebhook({ rawBody, signature, body }) {
  if (!signature) throw unauthorized('This webhook is not signed.');

  const expected = sign(rawBody ?? '');
  const given = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');

  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
    throw unauthorized('The webhook signature did not match.');
  }

  const refundStatus = REFUND_STATUS_BY_EVENT[body.event];
  if (refundStatus) {
    if (!body.providerRefundRef) throw badRequest('A refund event needs providerRefundRef.');
    return {
      kind: 'refund',
      providerRefundRef: body.providerRefundRef,
      status: refundStatus,
      eventId: body.eventId ?? null,
      failureReason: body.failureReason ?? null,
      raw: { provider: NAME, ...body },
    };
  }

  const status = STATUS_BY_OUTCOME[body.event] ?? null;
  if (!status) throw badRequest('Unknown webhook event.');
  if (!body.providerRef) throw badRequest('A payment event needs providerRef.');

  return {
    kind: 'payment',
    providerRef: body.providerRef,
    status,
    amountPaise: body.amountPaise ?? null,
    failureReason: body.failureReason ?? null,
    raw: { provider: NAME, ...body },
  };
}
