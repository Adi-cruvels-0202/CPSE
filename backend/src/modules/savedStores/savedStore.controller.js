import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../../lib/response.js';
import * as savedStoreService from './savedStore.service.js';

/** Checklist 9.1 */
export const saveStore = asyncHandler(async (req, res) => {
  sendSuccess(res, await savedStoreService.saveStore(req.customer.id, req.params.storeId));
});

/** Checklist 9.1 */
export const unsaveStore = asyncHandler(async (req, res) => {
  sendSuccess(res, await savedStoreService.unsaveStore(req.customer.id, req.params.storeId));
});

/** Checklist 9.2 */
export const listSavedStores = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const { savedStores, total } = await savedStoreService.listSavedStores(req.customer.id, req.query);

  sendSuccess(res, { savedStores }, { meta: paginationMeta({ page, limit, total }) });
});
