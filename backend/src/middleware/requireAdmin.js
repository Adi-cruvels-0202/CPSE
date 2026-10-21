import { asyncHandler } from '../lib/asyncHandler.js';
import { forbidden, internal } from '../lib/errors.js';
import { supabaseAdmin } from '../lib/supabase.js';

/**
 * Platform admins (migrations 0039, 0045). Runs after requireAuth. Being an
 * admin is a row in platform_admins that only an operator (scripts/admin.js)
 * or a superadmin creates, so a signed-in customer or shop owner is refused
 * with 403.
 *
 * Every admin has one role, and each role can do exactly this:
 *
 *   superadmin  everything below, plus suspending and reinstating accounts
 *               and adding, changing and removing admins
 *   reviewer    store verification (approve, send back, revoke) and taking a
 *               store off the platform; read-only accounts
 *   support     escalated customer support; read-only stores and accounts
 *
 * Every admin can see the overview and the action log.
 */
export const ADMIN_ROLES = ['superadmin', 'reviewer', 'support'];

export const PERMISSIONS = {
  viewOverview: ['superadmin', 'reviewer', 'support'],
  viewStores: ['superadmin', 'reviewer', 'support'],
  viewAccounts: ['superadmin', 'reviewer', 'support'],
  viewLog: ['superadmin', 'reviewer', 'support'],
  reviewStores: ['superadmin', 'reviewer'],
  moderateStores: ['superadmin', 'reviewer'],
  handleSupport: ['superadmin', 'support'],
  suspendAccounts: ['superadmin'],
  manageAdmins: ['superadmin'],
};

/** What this role may do, as the console needs to know it. */
export const permissionsFor = (role) =>
  Object.entries(PERMISSIONS).filter(([, roles]) => roles.includes(role)).map(([name]) => name);

export async function loadAdmin(userId) {
  const { data, error } = await supabaseAdmin
    .from('platform_admins')
    .select('id, email, full_name, role, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw internal('Could not load the admin.');
  return data ? { ...data, role: data.role ?? 'superadmin' } : null;
}

export const requireAdmin = asyncHandler(async (req, res, next) => {
  const admin = await loadAdmin(req.authUser.id);
  if (!admin) return next(forbidden('This account is not a platform admin.'));
  req.admin = admin;
  return next();
});

/**
 * requireAdmin, then one permission from PERMISSIONS. A refusal names what the
 * role cannot do, so a support admin knows to ask a reviewer.
 */
export function requirePermission(permission) {
  const allowed = PERMISSIONS[permission];
  if (!allowed) throw new Error(`Unknown admin permission ${permission}`);
  return [
    requireAdmin,
    (req, res, next) => {
      if (allowed.includes(req.admin.role)) return next();
      return next(forbidden(`Your admin role (${req.admin.role}) cannot do this. Ask a ${allowed[0]}.`));
    },
  ];
}
