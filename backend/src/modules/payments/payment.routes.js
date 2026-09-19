import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import * as controller from './payment.controller.js';
import { orderIdParams, verifyPaymentSchema, webhookSchema } from './payment.schemas.js';

export const paymentRouter = Router();

/** Checklist 7.3. Public: the checkout screen needs it before anything exists. */
paymentRouter.get('/methods', controller.getMethods);

/** Checklist 7.11. No requireAuth — the gateway authenticates with a signature. */
paymentRouter.post('/webhook', validate({ body: webhookSchema }), controller.webhook);

paymentRouter.post(
  '/:orderId/initiate',
  requireAuth,
  validate({ params: orderIdParams }),
  controller.initiate,
);

paymentRouter.post(
  '/:orderId/verify',
  requireAuth,
  validate({ params: orderIdParams, body: verifyPaymentSchema }),
  controller.verify,
);
