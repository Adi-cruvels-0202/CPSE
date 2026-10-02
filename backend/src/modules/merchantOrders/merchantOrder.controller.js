import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../../lib/response.js';
import * as orders from './merchantOrder.service.js';

/** requireStoreOwner has put the caller's own store on `req.store`. */

export const listOrders = asyncHandler(async (req, res) => {
  const { orders: rows, counts, total } = await orders.listOrders(req.store, req.query);
  sendSuccess(res, { orders: rows, counts }, { meta: paginationMeta({ page: req.query.page, limit: req.query.limit, total }) });
});

export const getOrder = asyncHandler(async (req, res) => {
  sendSuccess(res, { order: await orders.getOrder(req.store, req.params.orderId) });
});

const action = (run) =>
  asyncHandler(async (req, res) => {
    sendSuccess(res, { order: await run(req.store, req.params.orderId, req.body ?? {}) });
  });

export const acceptOrder = action(orders.acceptOrder);
export const rejectOrder = action(orders.rejectOrder);
export const setOrderStatus = action(orders.setOrderStatus);
export const completeOrder = action(orders.completeOrder);
export const cancelOrder = action(orders.cancelOrder);
