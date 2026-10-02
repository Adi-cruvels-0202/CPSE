import { asyncHandler } from '../lib/asyncHandler.js';
import { merchantRequired, notFound, internal } from '../lib/errors.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { loadMerchant } from '../modules/auth/auth.service.js';

/**
 * The role check for every /merchant route (MERGE_MAPPING D-2). Runs after
 * requireAuth, which has already verified the token, and loads the merchants
 * row onto `req.merchant`.
 *
 * Signed in but not a merchant → 403 MERCHANT_REQUIRED. That is the one place
 * a 403 is right: it says what the caller is, not whether something exists.
 */
export const requireMerchant = asyncHandler(async (req, res, next) => {
  const merchant = await loadMerchant(req.authUser.id);
  if (!merchant) return next(merchantRequired());

  req.merchant = merchant;
  return next();
});

/**
 * The ownership check for every /merchant/stores/:storeId route. Runs after
 * requireMerchant and after the :storeId param has been validated as a uuid.
 *
 * A store that does not exist and one that belongs to another merchant are the
 * same 404 — the same rule as the customer API, so a storeId cannot be used to
 * learn that someone else's store exists. The store is loaded onto `req.store`.
 *
 * Deliberately not filtered by is_active or is_published: a merchant manages
 * their store in every state, including before it is published.
 */
export const requireStoreOwner = asyncHandler(async (req, res, next) => {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select('*')
    .eq('id', req.params.storeId)
    .eq('owner_id', req.merchant.id)
    .maybeSingle();

  if (error) return next(internal('Could not load the store.'));
  if (!data) return next(notFound('Store'));

  req.store = data;
  return next();
});
