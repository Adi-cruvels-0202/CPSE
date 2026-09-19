import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { optionalAuth, requireAuth } from '../../middleware/requireAuth.js';
import * as controller from './store.controller.js';
import * as savedStoreController from '../savedStores/savedStore.controller.js';
import { savedStoreParams } from '../savedStores/savedStore.schemas.js';
import { emptyBody } from '../../lib/schemas.js';
import {
  storeSlugParams,
  productListQuery,
  storeProductParams,
  searchQuery,
} from './store.schemas.js';

/**
 * Public storefront. optionalAuth on the whole router: these pages must open
 * from a plain shared link with no token (checklist 3.5), and personalise when
 * one is present (3.6).
 */
export const storeRouter = Router();

storeRouter.use(optionalAuth);

/**
 * Checklist 9.1 — save / unsave. Keyed by the store's uuid, not its slug (see
 * savedStore.schemas.js), and `requireAuth` on top of the router's optionalAuth
 * because a favourite must have an owner. Declared before the slug routes so a
 * uuid is never read as a slug — it would not match the slug pattern anyway.
 */
storeRouter.post(
  '/:storeId/save',
  requireAuth,
  validate({ params: savedStoreParams, body: emptyBody }),
  savedStoreController.saveStore,
);
storeRouter.delete(
  '/:storeId/save',
  requireAuth,
  validate({ params: savedStoreParams, body: emptyBody }),
  savedStoreController.unsaveStore,
);

storeRouter.get('/:slug', validate({ params: storeSlugParams }), controller.getStore);

storeRouter.get(
  '/:slug/categories',
  validate({ params: storeSlugParams }),
  controller.getCategories,
);

storeRouter.get(
  '/:slug/products',
  validate({ params: storeSlugParams, query: productListQuery }),
  controller.getProducts,
);

// Declared before /:slug/products/:productId so "search" is never read as a
// product id — it would not parse as a uuid anyway, but the order makes the
// intent explicit.
storeRouter.get(
  '/:slug/search',
  validate({ params: storeSlugParams, query: searchQuery }),
  controller.searchProducts,
);

storeRouter.get(
  '/:slug/products/:productId',
  validate({ params: storeProductParams }),
  controller.getProduct,
);
