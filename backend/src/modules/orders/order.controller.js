import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, sendCreated, paginationMeta } from '../../lib/response.js';
import { badRequest } from '../../lib/errors.js';
import * as orderService from './order.service.js';

/**
 * Checklist 7.4 + 7.5. The Idempotency-Key header is the duplicate-submission
 * guard (D10): the same key from the same customer returns the original order
 * with 200 instead of creating a second one.
 */
export const createOrder = asyncHandler(async (req, res) => {
  const idempotencyKey = req.get('idempotency-key')?.trim() || null;

  if (idempotencyKey && idempotencyKey.length > 200) {
    throw badRequest('The Idempotency-Key header is too long.');
  }

  const { order, replayed } = await orderService.createOrder(req.customer.id, req.body, {
    idempotencyKey,
  });

  // 200 rather than 201 on a replay: nothing was created this time.
  if (replayed) return sendSuccess(res, { order, replayed: true });
  return sendCreated(res, { order, replayed: false });
});

/** Checklist 8.1 */
export const listOrders = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const { orders, total } = await orderService.listOrders(req.customer.id, req.query);

  sendSuccess(res, { orders }, { meta: paginationMeta({ page, limit, total }) });
});

/** Checklist 8.2 */
export const getOrder = asyncHandler(async (req, res) => {
  sendSuccess(res, { order: await orderService.getOrder(req.customer.id, req.params.id) });
});

/** Checklist 8.4 */
export const cancelOrder = asyncHandler(async (req, res) => {
  const order = await orderService.cancelOrder(req.customer.id, req.params.id, req.body.reason);
  sendSuccess(res, { order });
});

/** Checklist 8.6 */
export const getReceipt = asyncHandler(async (req, res) => {
  sendSuccess(res, { receipt: await orderService.getReceipt(req.customer.id, req.params.id) });
});

/** Checklist 8.7 */
export const reorder = asyncHandler(async (req, res) => {
  sendCreated(res, await orderService.reorder(req.customer.id, req.params.id));
});
