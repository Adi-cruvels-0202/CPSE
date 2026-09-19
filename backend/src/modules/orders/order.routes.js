import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { env } from '../../config/env.js';
import * as controller from './order.controller.js';
import { advanceOrder } from './order.testing.controller.js';
import {
  createOrderSchema,
  orderListQuery,
  orderParams,
  cancelOrderSchema,
  advanceOrderSchema,
} from './order.schemas.js';

/** Every order belongs to somebody, so the whole router is authenticated. */
export const orderRouter = Router();

orderRouter.use(requireAuth);

orderRouter.post('/', validate({ body: createOrderSchema }), controller.createOrder);
orderRouter.get('/', validate({ query: orderListQuery }), controller.listOrders);

orderRouter.get('/:id', validate({ params: orderParams }), controller.getOrder);
orderRouter.get('/:id/receipt', validate({ params: orderParams }), controller.getReceipt);

orderRouter.post(
  '/:id/cancel',
  validate({ params: orderParams, body: cancelOrderSchema }),
  controller.cancelOrder,
);
orderRouter.post('/:id/reorder', validate({ params: orderParams }), controller.reorder);

// ⚠️ TEST-ONLY (checklist 8.8) — stands in for the merchant dashboard so the
// order lifecycle can be exercised. Not mounted at all unless the flag is on.
if (env.ENABLE_TEST_ENDPOINTS) {
  orderRouter.post(
    '/:id/test-advance',
    validate({ params: orderParams, body: advanceOrderSchema }),
    advanceOrder,
  );
}
