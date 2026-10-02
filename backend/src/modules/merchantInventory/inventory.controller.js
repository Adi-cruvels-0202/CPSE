import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../../lib/response.js';
import * as inventory from './inventory.service.js';

/** requireStoreOwner has put the caller's own store on `req.store`. */

const movement = (kind) =>
  asyncHandler(async (req, res) => {
    sendSuccess(res, await inventory.recordMovement(req.store, req.merchant, kind, req.body));
  });

export const stockIn = movement('stock_in');
export const stockOut = movement('stock_out');
export const adjust = movement('adjustment');

export const history = asyncHandler(async (req, res) => {
  const { entries, total } = await inventory.listHistory(req.store, req.query);
  sendSuccess(res, { entries }, { meta: paginationMeta({ page: req.query.page, limit: req.query.limit, total }) });
});
