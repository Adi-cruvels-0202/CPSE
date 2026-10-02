import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireMerchant, requireStoreOwner } from '../../middleware/requireMerchant.js';
import { emptyBody } from '../../lib/schemas.js';
import * as controller from './merchantStore.controller.js';
import {
  createStoreSchema,
  updateStoreSchema,
  hoursSchema,
  deliverySchema,
  paymentsSchema,
  storeParams,
} from './merchantStore.schemas.js';

/**
 * /merchant/stores — MERCHANT_API.md, Stores. Each route spells out its guards
 * in the order merchant.routes.js describes, so the order is visible at the
 * route rather than implied by a router-level `use`.
 */
export const merchantStoreRouter = Router();

/** Every /merchant/stores/:storeId route starts with these, then adds its body. */
const ownStore = [requireAuth, validate({ params: storeParams }), requireMerchant, requireStoreOwner];

merchantStoreRouter.get('/', requireAuth, requireMerchant, controller.listStores);
merchantStoreRouter.post(
  '/',
  writeLimiter,
  requireAuth,
  requireMerchant,
  validate({ body: createStoreSchema }),
  controller.createStore,
);

merchantStoreRouter.get('/:storeId', ...ownStore, controller.getStore);
merchantStoreRouter.patch(
  '/:storeId',
  writeLimiter,
  ...ownStore,
  validate({ body: updateStoreSchema }),
  controller.updateStore,
);

merchantStoreRouter.post(
  '/:storeId/publish',
  writeLimiter,
  ...ownStore,
  validate({ body: emptyBody }),
  controller.publishStore,
);
merchantStoreRouter.post(
  '/:storeId/unpublish',
  writeLimiter,
  ...ownStore,
  validate({ body: emptyBody }),
  controller.unpublishStore,
);

merchantStoreRouter.put('/:storeId/hours', writeLimiter, ...ownStore, validate({ body: hoursSchema }), controller.setHours);
merchantStoreRouter.put(
  '/:storeId/delivery',
  writeLimiter,
  ...ownStore,
  validate({ body: deliverySchema }),
  controller.setDelivery,
);
merchantStoreRouter.put(
  '/:storeId/payments',
  writeLimiter,
  ...ownStore,
  validate({ body: paymentsSchema }),
  controller.setPayments,
);
