import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as controller from './order.controller.js';
import { emptyBody } from '../../lib/schemas.js';
import {
  createOrderSchema,
  orderListQuery,
  orderParams,
  cancelOrderSchema,
} from './order.schemas.js';

/** Every order belongs to somebody, so the whole router is authenticated. */
export const orderRouter = Router();

orderRouter.use(requireAuth);

// Checklist 10.7: order creation runs a transaction, reserves stock and can
// open a payment intent. It is metered more tightly than a read.
orderRouter.post('/', writeLimiter, validate({ body: createOrderSchema }), controller.createOrder);
orderRouter.get('/', validate({ query: orderListQuery }), controller.listOrders);

orderRouter.get('/:id', validate({ params: orderParams }), controller.getOrder);
orderRouter.get('/:id/receipt', validate({ params: orderParams }), controller.getReceipt);

orderRouter.post(
  '/:id/cancel',
  validate({ params: orderParams, body: cancelOrderSchema }),
  controller.cancelOrder,
);
orderRouter.post(
  '/:id/reorder',
  writeLimiter,
  validate({ params: orderParams, body: emptyBody }),
  controller.reorder,
);
