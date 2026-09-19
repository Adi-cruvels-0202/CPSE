/**
 * The payment abstraction — checklist 7.1, decision D7.
 *
 * Every provider implements the same four functions, and nothing outside this
 * folder knows which one is configured. Swapping the mock for Razorpay or
 * Stripe means writing one more module and changing PAYMENT_PROVIDER; no
 * order, cart or checkout code changes.
 *
 *   initiate(context)      -> { providerRef, clientPayload, status }
 *       Opens an attempt with the gateway and returns what the browser needs
 *       to continue. Never marks anything paid.
 *
 *   verify(context)        -> { status, providerRef, failureReason?, raw }
 *       The client-side confirmation path: the browser comes back from the
 *       gateway and we ask the provider what really happened. The ANSWER is
 *       the provider's, never the client's (checklist 7.13).
 *
 *   handleWebhook(context) -> { providerRef, status, amountPaise?, failureReason?, raw }
 *       The server-to-server path. Must verify the signature itself and throw
 *       if it does not match.
 *
 *   methods()              -> [{ code, label, description, requiresOnlineFlow }]
 *       What the platform can offer (checklist 7.3).
 */

import { env } from '../../config/env.js';
import { internal } from '../../lib/errors.js';
import * as mockProvider from './mock.provider.js';

const providers = { mock: mockProvider };

export function paymentProvider(name = env.PAYMENT_PROVIDER) {
  const provider = providers[name];
  // A misconfigured provider must fail loudly rather than silently falling
  // back to the mock and accepting money that was never taken.
  if (!provider) throw internal(`Payment provider "${name}" is not configured.`);
  return provider;
}

/** Checklist 7.3. The platform's methods, independent of any one provider. */
export function paymentMethods() {
  return paymentProvider().methods();
}
