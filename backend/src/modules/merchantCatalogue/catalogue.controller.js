import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, sendCreated, sendNoContent, paginationMeta } from '../../lib/response.js';
import * as categories from './category.service.js';
import * as products from './product.service.js';

/** requireStoreOwner has put the caller's own store on `req.store`. */

// ── Categories ───────────────────────────────────────────────────────────────

export const listCategories = asyncHandler(async (req, res) => {
  sendSuccess(res, { categories: await categories.listCategories(req.store) });
});

export const createCategory = asyncHandler(async (req, res) => {
  sendCreated(res, { category: await categories.createCategory(req.store, req.body) });
});

export const updateCategory = asyncHandler(async (req, res) => {
  sendSuccess(res, {
    category: await categories.updateCategory(req.store, req.params.categoryId, req.body),
  });
});

export const activateCategory = asyncHandler(async (req, res) => {
  sendSuccess(res, { category: await categories.setCategoryActive(req.store, req.params.categoryId, true) });
});

export const deactivateCategory = asyncHandler(async (req, res) => {
  sendSuccess(res, { category: await categories.setCategoryActive(req.store, req.params.categoryId, false) });
});

// ── Products ─────────────────────────────────────────────────────────────────

export const listProducts = asyncHandler(async (req, res) => {
  const { products: rows, total } = await products.listProducts(req.store, req.query);
  sendSuccess(res, { products: rows }, { meta: paginationMeta({ page: req.query.page, limit: req.query.limit, total }) });
});

export const createProduct = asyncHandler(async (req, res) => {
  sendCreated(res, { product: await products.createProduct(req.store, req.merchant, req.body) });
});

export const getProduct = asyncHandler(async (req, res) => {
  sendSuccess(res, { product: await products.getProduct(req.store, req.params.productId) });
});

export const updateProduct = asyncHandler(async (req, res) => {
  sendSuccess(res, { product: await products.updateProduct(req.store, req.params.productId, req.body) });
});

export const activateProduct = asyncHandler(async (req, res) => {
  sendSuccess(res, { product: await products.setProductActive(req.store, req.params.productId, true) });
});

export const deactivateProduct = asyncHandler(async (req, res) => {
  sendSuccess(res, { product: await products.setProductActive(req.store, req.params.productId, false) });
});

/** Archives the product (P-8, revised) — see product.service archiveProduct. */
export const deleteProduct = asyncHandler(async (req, res) => {
  await products.archiveProduct(req.store, req.params.productId);
  sendNoContent(res);
});

// ── Variants ─────────────────────────────────────────────────────────────────

export const addVariant = asyncHandler(async (req, res) => {
  sendCreated(res, {
    product: await products.addVariant(req.store, req.merchant, req.params.productId, req.body),
  });
});

export const updateVariant = asyncHandler(async (req, res) => {
  const { productId, variantId } = req.params;
  sendSuccess(res, { product: await products.updateVariant(req.store, productId, variantId, req.body) });
});

export const activateVariant = asyncHandler(async (req, res) => {
  const { productId, variantId } = req.params;
  sendSuccess(res, { product: await products.setVariantActive(req.store, productId, variantId, true) });
});

export const deactivateVariant = asyncHandler(async (req, res) => {
  const { productId, variantId } = req.params;
  sendSuccess(res, { product: await products.setVariantActive(req.store, productId, variantId, false) });
});

// ── Photos ───────────────────────────────────────────────────────────────────

export const uploadProductImage = asyncHandler(async (req, res) => {
  sendCreated(res, { product: await products.addProductImage(req.store, req.params.productId, req.file) });
});

export const deleteProductImage = asyncHandler(async (req, res) => {
  const { productId, imageId } = req.params;
  sendSuccess(res, { product: await products.removeProductImage(req.store, productId, imageId) });
});
