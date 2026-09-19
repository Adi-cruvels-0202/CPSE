import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../../lib/response.js';
import * as storeService from './store.service.js';

/**
 * `req.customer` is set by optionalAuth, so it is null for anonymous visitors
 * (checklist 3.5) and a profile when a token is present (3.6).
 */
const customerId = (req) => req.customer?.id ?? null;

/** Checklist 3.1 */
export const getStore = asyncHandler(async (req, res) => {
  const store = await storeService.getStorePage(req.params.slug, customerId(req));
  sendSuccess(res, { store });
});

/** Checklist 3.3 */
export const getCategories = asyncHandler(async (req, res) => {
  const { store, categories } = await storeService.listCategories(req.params.slug);
  sendSuccess(res, { storeId: store.id, categories });
});

/** Checklist 3.4 */
export const getProducts = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const { store, products, total } = await storeService.listProducts(req.params.slug, req.query);

  sendSuccess(
    res,
    { storeId: store.id, products },
    { meta: paginationMeta({ page, limit, total }) },
  );
});

/** Checklist 4.1 */
export const getProduct = asyncHandler(async (req, res) => {
  const { store, product } = await storeService.getProductDetail(
    req.params.slug,
    req.params.productId,
  );
  sendSuccess(res, { storeId: store.id, product });
});

/** Checklist 4.2 */
export const searchProducts = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const { store, query, products, total } = await storeService.searchProducts(
    req.params.slug,
    req.query,
  );

  sendSuccess(
    res,
    // Checklist 4.3: an empty result is a clean, fully-shaped payload — the
    // storefront renders "no matches for <query>" without a second request.
    { storeId: store.id, query, products },
    { meta: paginationMeta({ page, limit, total }) },
  );
});
