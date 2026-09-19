import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../../lib/response.js';
import * as khataService from './khata.service.js';

/** Checklist 9.6 */
export const listAccounts = asyncHandler(async (req, res) => {
  sendSuccess(res, await khataService.listAccounts(req.customer.id));
});

/** Checklist 9.7 */
export const getAccount = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const { total, ...data } = await khataService.getAccount(
    req.customer.id,
    req.params.accountId,
    req.query,
  );

  sendSuccess(res, data, { meta: paginationMeta({ page, limit, total }) });
});

/** Checklist 9.8 */
export const getStatement = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const { total, ...data } = await khataService.getStatement(
    req.customer.id,
    req.params.accountId,
    req.query,
  );

  sendSuccess(res, data, { meta: paginationMeta({ page, limit, total }) });
});
