import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireMerchant, requireStoreOwner } from '../middleware/requireMerchant.js';
import { asyncHandler } from './asyncHandler.js';
import { sendSuccess, sendCreated, paginationMeta } from './response.js';

/**
 * The guard chain every store-scoped merchant route uses, in the order
 * merchant.routes.js documents:
 *
 *   requireAuth (401) → params (422) → requireMerchant (403)
 *     → requireStoreOwner (404) → query/body (422)
 *
 * `paramsShape` extends `{ storeId }` with the route's other ids.
 */
export const uuid = (what) => z.string().uuid(`Not a valid ${what}.`);

export const storeIdParams = (extra = {}) => z.object({ storeId: uuid('store'), ...extra }).strict();

export function ownStore({ params = storeIdParams(), query, body, write = false } = {}) {
  const chain = [];
  if (write) chain.push(writeLimiter);
  chain.push(requireAuth, validate({ params }), requireMerchant, requireStoreOwner);
  if (query || body) chain.push(validate({ ...(query ? { query } : {}), ...(body ? { body } : {}) }));
  return chain;
}

/** `run(req)` → data, sent as 200 (or 201 with `{ created: true }`). */
export const respond = (run, { created = false } = {}) =>
  asyncHandler(async (req, res) => {
    const data = await run(req);
    return created ? sendCreated(res, data) : sendSuccess(res, data);
  });

/** For list endpoints: `run(req)` → `{ data, total }`, paged by req.query. */
export const respondPage = (run) =>
  asyncHandler(async (req, res) => {
    const { data, total } = await run(req);
    sendSuccess(res, data, {
      meta: paginationMeta({ page: req.query.page ?? 1, limit: req.query.limit ?? 20, total }),
    });
  });

export const pageQuery = (extra = {}, { maxLimit = 100 } = {}) =>
  z
    .object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(maxLimit).default(20),
      ...extra,
    })
    .strict();
