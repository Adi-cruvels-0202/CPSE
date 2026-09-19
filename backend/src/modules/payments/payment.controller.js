import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess } from '../../lib/response.js';
import { env } from '../../config/env.js';
import { paymentMethods } from './provider.js';
import * as paymentService from './payment.service.js';

/** Checklist 7.3 */
export const getMethods = asyncHandler(async (req, res) => {
  sendSuccess(res, { methods: paymentMethods() });
});

/** Checklist 7.10 */
export const initiate = asyncHandler(async (req, res) => {
  const result = await paymentService.initiatePayment(req.customer.id, req.params.orderId);
  sendSuccess(res, result);
});

/** Checklist 7.12 */
export const verify = asyncHandler(async (req, res) => {
  const result = await paymentService.verifyPayment(req.customer.id, req.params.orderId, req.body);
  sendSuccess(res, result);
});

/**
 * Checklist 7.11. Unauthenticated by design — the gateway has no session. Its
 * signature over the raw body is the authentication, and an unsigned or
 * mis-signed call never reaches the database.
 */
export const webhook = asyncHandler(async (req, res) => {
  const result = await paymentService.handleWebhook({
    rawBody: req.rawBody ?? '',
    signature: req.get('x-cpse-signature'),
    body: req.body,
    providerName: env.PAYMENT_PROVIDER,
  });

  // Always 200 once the signature checks out: a gateway retries anything else
  // forever, and "we already had this event" is not an error.
  sendSuccess(res, result);
});
