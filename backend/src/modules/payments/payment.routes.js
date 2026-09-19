import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { webhookLimiter, writeLimiter } from '../../middleware/rateLimit.js';
import * as controller from './payment.controller.js';
import { orderIdParams, verifyPaymentSchema, webhookSchema } from './payment.schemas.js';
import { emptyBody } from '../../lib/schemas.js';

export const paymentRouter = Router();

/** Checklist 7.3. Public: the checkout screen needs it before anything exists. */
paymentRouter.get('/methods', controller.getMethods);

/** Checklist 7.11. No requireAuth — the gateway authenticates with a signature. */
paymentRouter.post(
  '/webhook',
  webhookLimiter,
  validate({ body: webhookSchema }),
  controller.webhook,
);

paymentRouter.post(
  '/:orderId/initiate',
  writeLimiter,
  requireAuth,
  validate({ params: orderIdParams, body: emptyBody }),
  controller.initiate,
);

paymentRouter.post(
  '/:orderId/verify',
  writeLimiter,
  requireAuth,
  validate({ params: orderIdParams, body: verifyPaymentSchema }),
  controller.verify,
);
