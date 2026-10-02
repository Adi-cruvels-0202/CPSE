import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, sendCreated, paginationMeta } from '../../lib/response.js';
import { badRequest } from '../../lib/errors.js';
import * as sales from './sale.service.js';

/**
 * The Idempotency-Key header guards the "Charge" button the same way it guards
 * a customer's order (D10): the same key returns the first sale with 200.
 */
export const createSale = asyncHandler(async (req, res) => {
  const idempotencyKey = req.get('idempotency-key')?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > 200) throw badRequest('The Idempotency-Key header is too long.');

  const { sale, replayed } = await sales.createSale(req.store, req.merchant, req.body, { idempotencyKey });
  if (replayed) return sendSuccess(res, { sale, replayed: true });
  return sendCreated(res, { sale, replayed: false });
});

export const getSale = asyncHandler(async (req, res) => {
  sendSuccess(res, { sale: await sales.getSale(req.store, req.params.saleId) });
});

export const listSales = asyncHandler(async (req, res) => {
  const { sales: rows, total } = await sales.listSales(req.store, req.query);
  sendSuccess(res, { sales: rows }, { meta: paginationMeta({ page: req.query.page, limit: req.query.limit, total }) });
});
