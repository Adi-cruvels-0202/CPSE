import { asyncHandler } from '../lib/asyncHandler.js';
import { unauthorized } from '../lib/errors.js';
import { verifyAccessToken, loadCustomer } from '../modules/auth/auth.service.js';

/** Pulls the bearer token out of the Authorization header, if there is one. */
export function bearerToken(req) {
  const header = req.get('authorization');
  if (!header) return null;

  const [scheme, token] = header.split(' ');
  if (!/^bearer$/i.test(scheme ?? '') || !token) return null;
  return token.trim() || null;
}

/**
 * Checklist 2.6. Verifies the Supabase JWT and loads the customer profile onto
 * `req.customer`, so handlers never re-read it. `req.accessToken` is kept for
 * the few operations that must act as the user (logout, RLS-scoped reads).
 *
 * A valid token whose customers row is missing is treated as unauthenticated:
 * the row is created by a database trigger, so its absence means the account
 * was removed underneath us.
 */
export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = bearerToken(req);
  if (!token) return next(unauthorized('Sign in to continue.'));

  const user = await verifyAccessToken(token);
  if (!user) return next(unauthorized('Your session has expired. Sign in again.'));

  const customer = await loadCustomer(user.id);
  if (!customer) return next(unauthorized('Your session has expired. Sign in again.'));

  req.accessToken = token;
  req.authUser = user;
  req.customer = customer;
  return next();
});

/**
 * Checklist 2.7. For public pages that personalise when signed in — a store
 * page shows a saved-store heart only if we know who is looking. Never fails:
 * a missing, malformed or expired token simply leaves `req.customer` null.
 */
export const optionalAuth = asyncHandler(async (req, res, next) => {
  req.customer = null;
  req.authUser = null;
  req.accessToken = null;

  const token = bearerToken(req);
  if (!token) return next();

  const user = await verifyAccessToken(token);
  if (!user) return next();

  const customer = await loadCustomer(user.id);
  if (!customer) return next();

  req.accessToken = token;
  req.authUser = user;
  req.customer = customer;
  return next();
});
