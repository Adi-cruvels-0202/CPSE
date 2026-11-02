import { asyncHandler } from '../lib/asyncHandler.js';
import { forbidden, internal } from '../lib/errors.js';
import { supabaseAdmin } from '../lib/supabase.js';

/**
 * The platform admin (migrations 0039, 0045, 0046). Runs after requireAuth.
 * Being an admin is a row in platform_admins, made only by the operator
 * (`npm run admin -- grant <email>`, or the seed's demo admin), so a
 * signed-in customer or shop owner is refused with 403. There is one kind of
 * admin, and an admin can do everything in the portal.
 */
export async function loadAdmin(userId) {
  const { data, error } = await supabaseAdmin
    .from('platform_admins')
    .select('id, email, full_name, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw internal('Could not load the admin.');
  return data ?? null;
}

export const requireAdmin = asyncHandler(async (req, res, next) => {
  const admin = await loadAdmin(req.authUser.id);
  if (!admin) return next(forbidden('This account is not a platform admin.'));
  req.admin = admin;
  return next();
});
