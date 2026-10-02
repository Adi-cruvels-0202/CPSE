import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireMerchant, requireStoreOwner } from '../../middleware/requireMerchant.js';
import { emptyBody } from '../../lib/schemas.js';
import { storeParams } from '../merchantStores/merchantStore.schemas.js';
import * as controller from './merchantOrder.controller.js';
import { orderParams, orderListQuery, rejectSchema, cancelSchema, statusSchema } from './merchantOrder.schemas.js';

/**
 * /merchant/stores/:storeId/orders — MERCHANT_API.md, Orders. Mounted at
 * /merchant/stores; guards in merchant.routes.js's order.
 */
export const merchantOrderRouter = Router();

const own = (params) => [requireAuth, validate({ params }), requireMerchant, requireStoreOwner];
const write = (body) => [writeLimiter, ...own(orderParams), validate({ body })];

merchantOrderRouter.get(
  '/:storeId/orders',
  requireAuth,
  validate({ params: storeParams, query: orderListQuery }),
  requireMerchant,
  requireStoreOwner,
  controller.listOrders,
);
merchantOrderRouter.get('/:storeId/orders/:orderId', ...own(orderParams), controller.getOrder);

merchantOrderRouter.post('/:storeId/orders/:orderId/accept', ...write(emptyBody), controller.acceptOrder);
merchantOrderRouter.post('/:storeId/orders/:orderId/reject', ...write(rejectSchema), controller.rejectOrder);
merchantOrderRouter.post('/:storeId/orders/:orderId/status', ...write(statusSchema), controller.setOrderStatus);
merchantOrderRouter.post('/:storeId/orders/:orderId/complete', ...write(emptyBody), controller.completeOrder);
merchantOrderRouter.post('/:storeId/orders/:orderId/cancel', ...write(cancelSchema), controller.cancelOrder);
