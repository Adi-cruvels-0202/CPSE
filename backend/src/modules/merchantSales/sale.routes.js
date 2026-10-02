import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireMerchant, requireStoreOwner } from '../../middleware/requireMerchant.js';
import { storeParams } from '../merchantStores/merchantStore.schemas.js';
import * as controller from './sale.controller.js';
import { createSaleSchema, saleListQuery, saleParams } from './sale.schemas.js';

/** /merchant/stores/:storeId/sales — counter (POS) sales. Mounted at /merchant/stores. */
export const saleRouter = Router();

saleRouter.get(
  '/:storeId/sales',
  requireAuth,
  validate({ params: storeParams, query: saleListQuery }),
  requireMerchant,
  requireStoreOwner,
  controller.listSales,
);
saleRouter.post(
  '/:storeId/sales',
  writeLimiter,
  requireAuth,
  validate({ params: storeParams }),
  requireMerchant,
  requireStoreOwner,
  validate({ body: createSaleSchema }),
  controller.createSale,
);
saleRouter.get(
  '/:storeId/sales/:saleId',
  requireAuth,
  validate({ params: saleParams }),
  requireMerchant,
  requireStoreOwner,
  controller.getSale,
);
