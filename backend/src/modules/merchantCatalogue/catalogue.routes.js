import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireMerchant, requireStoreOwner } from '../../middleware/requireMerchant.js';
import { emptyBody } from '../../lib/schemas.js';
import { receiveImage } from '../../lib/imageUpload.js';
import { storeParams } from '../merchantStores/merchantStore.schemas.js';
import * as controller from './catalogue.controller.js';
import {
  categoryParams,
  productParams,
  variantParams,
  createCategorySchema,
  updateCategorySchema,
  createProductSchema,
  updateProductSchema,
  variantSchema,
  updateVariantSchema,
  productListQuery,
  imageParams,
} from './catalogue.schemas.js';

/**
 * /merchant/stores/:storeId/categories and …/products — MERCHANT_API.md,
 * Categories and Products and variants. Mounted at /merchant/stores beside the
 * store router; the full paths are written out here so the route audit sees
 * them as they are served.
 *
 * Guards, in merchant.routes.js's order: token → path ids → merchant → owns
 * this store → body.
 */
export const catalogueRouter = Router();

/** Path ids validated, then merchant, then the store must be theirs. */
const own = (params) => [requireAuth, validate({ params }), requireMerchant, requireStoreOwner];
const write = (params, body) => [writeLimiter, ...own(params), validate({ body })];

// ── Categories ───────────────────────────────────────────────────────────────

catalogueRouter.get('/:storeId/categories', ...own(storeParams), controller.listCategories);
catalogueRouter.post('/:storeId/categories', ...write(storeParams, createCategorySchema), controller.createCategory);
catalogueRouter.patch(
  '/:storeId/categories/:categoryId',
  ...write(categoryParams, updateCategorySchema),
  controller.updateCategory,
);
catalogueRouter.post(
  '/:storeId/categories/:categoryId/activate',
  ...write(categoryParams, emptyBody),
  controller.activateCategory,
);
catalogueRouter.post(
  '/:storeId/categories/:categoryId/deactivate',
  ...write(categoryParams, emptyBody),
  controller.deactivateCategory,
);

// ── Products ─────────────────────────────────────────────────────────────────

catalogueRouter.get(
  '/:storeId/products',
  requireAuth,
  validate({ params: storeParams, query: productListQuery }),
  requireMerchant,
  requireStoreOwner,
  controller.listProducts,
);
catalogueRouter.post('/:storeId/products', ...write(storeParams, createProductSchema), controller.createProduct);
catalogueRouter.get('/:storeId/products/:productId', ...own(productParams), controller.getProduct);
catalogueRouter.patch(
  '/:storeId/products/:productId',
  ...write(productParams, updateProductSchema),
  controller.updateProduct,
);
// Archives: the product leaves every list, its history stays (migration 0034).
catalogueRouter.delete(
  '/:storeId/products/:productId',
  writeLimiter,
  ...own(productParams),
  controller.deleteProduct,
);
catalogueRouter.post(
  '/:storeId/products/:productId/activate',
  ...write(productParams, emptyBody),
  controller.activateProduct,
);
catalogueRouter.post(
  '/:storeId/products/:productId/deactivate',
  ...write(productParams, emptyBody),
  controller.deactivateProduct,
);

// ── Variants ─────────────────────────────────────────────────────────────────

catalogueRouter.post(
  '/:storeId/products/:productId/variants',
  ...write(productParams, variantSchema),
  controller.addVariant,
);
catalogueRouter.patch(
  '/:storeId/products/:productId/variants/:variantId',
  ...write(variantParams, updateVariantSchema),
  controller.updateVariant,
);
catalogueRouter.post(
  '/:storeId/products/:productId/variants/:variantId/activate',
  ...write(variantParams, emptyBody),
  controller.activateVariant,
);
catalogueRouter.post(
  '/:storeId/products/:productId/variants/:variantId/deactivate',
  ...write(variantParams, emptyBody),
  controller.deactivateVariant,
);

// ── Photos (P1): multipart, one field named "file", JPEG/PNG/WebP ≤ 5 MB ─────

catalogueRouter.post(
  '/:storeId/products/:productId/images',
  writeLimiter,
  ...own(productParams),
  receiveImage,
  controller.uploadProductImage,
);
catalogueRouter.delete(
  '/:storeId/products/:productId/images/:imageId',
  writeLimiter,
  ...own(imageParams),
  controller.deleteProductImage,
);
