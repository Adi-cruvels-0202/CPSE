import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireMerchant, requireStoreOwner } from '../../middleware/requireMerchant.js';
import { storeParams } from '../merchantStores/merchantStore.schemas.js';
import * as controller from './inventory.controller.js';
import { stockInSchema, stockOutSchema, adjustSchema, historyQuery } from './inventory.schemas.js';

/**
 * /merchant/stores/:storeId/inventory — MERCHANT_API.md, Inventory. Mounted
 * at /merchant/stores; guards in merchant.routes.js's order.
 *
 * There is no inventory list: the product list already carries every
 * variant's on hand, reserved and available.
 */
export const inventoryRouter = Router();

const own = [requireAuth, validate({ params: storeParams }), requireMerchant, requireStoreOwner];

inventoryRouter.post('/:storeId/inventory/stock-in', writeLimiter, ...own, validate({ body: stockInSchema }), controller.stockIn);
inventoryRouter.post('/:storeId/inventory/stock-out', writeLimiter, ...own, validate({ body: stockOutSchema }), controller.stockOut);
inventoryRouter.post('/:storeId/inventory/adjust', writeLimiter, ...own, validate({ body: adjustSchema }), controller.adjust);
inventoryRouter.get(
  '/:storeId/inventory/history',
  requireAuth,
  validate({ params: storeParams, query: historyQuery }),
  requireMerchant,
  requireStoreOwner,
  controller.history,
);
