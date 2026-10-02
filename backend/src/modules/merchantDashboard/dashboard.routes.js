import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireMerchant, requireStoreOwner } from '../../middleware/requireMerchant.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess } from '../../lib/response.js';
import { storeParams } from '../merchantStores/merchantStore.schemas.js';
import { getDashboard } from './dashboard.service.js';

/** /merchant/stores/:storeId/dashboard. Mounted at /merchant/stores. */
export const dashboardRouter = Router();

dashboardRouter.get(
  '/:storeId/dashboard',
  requireAuth,
  validate({ params: storeParams }),
  requireMerchant,
  requireStoreOwner,
  asyncHandler(async (req, res) => {
    sendSuccess(res, { dashboard: await getDashboard(req.store) });
  }),
);
