import { asyncHandler } from '../lib/asyncHandler.js';
import { forbidden, internal } from '../lib/errors.js';
import { supabaseAdmin } from '../lib/supabase.js';

/**
 * Platform reviewers (migration 0039). Runs after requireAuth. Being a
 * reviewer is a row in platform_admins that only an operator creates, so a
 * signed-in customer or merchant is refused with 403 ADMIN_REQUIRED.
 */
export async function loadAdmin(userId) {
  const { data, error } = await supabaseAdmin
    .from('platform_admins')
    .select('id, email, full_name, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw internal('Could not load the reviewer.');
  return data ?? null;
}

export const requireAdmin = asyncHandler(async (req, res, next) => {
  const admin = await loadAdmin(req.authUser.id);
  if (!admin) return next(forbidden('This account cannot review stores.'));
  req.admin = admin;
  return next();
});
