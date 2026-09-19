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

/** The signature a gateway would send alongside the webhook body. */
export function sign(rawBody) {
  return crypto
    .createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET)
    .update(rawBody, 'utf8')
    .digest('hex');
}

/**
 * Checklist 7.11. Rejects anything whose signature does not match, so an
 * attacker who knows an order number still cannot mark it paid. Compared in
 * constant time, because a fast reject leaks the signature one byte at a time.
 */
export function handleWebhook({ rawBody, signature, body }) {
  if (!signature) throw unauthorized('This webhook is not signed.');

  const expected = sign(rawBody ?? '');
  const given = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');

  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
    throw unauthorized('The webhook signature did not match.');
  }

  const status = STATUS_BY_OUTCOME[body.event] ?? null;
  if (!status) throw badRequest('Unknown webhook event.');

  return {
    providerRef: body.providerRef,
    status,
    amountPaise: body.amountPaise ?? null,
    failureReason: body.failureReason ?? null,
    raw: { provider: NAME, ...body },
  };
}
