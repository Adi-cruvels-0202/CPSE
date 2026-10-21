import { supabaseAdmin } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';

/**
 * The admin action log (migration 0045): who did what to which store, account
 * or admin, and why. Append-only in the database. Written after the action
 * itself; a failure to write is logged loudly but does not undo the action,
 * which has already happened and has its own record (verification events, the
 * account row).
 */
export async function recordAdminAction(admin, { action, targetType, targetId = null, targetLabel = null, reason = null, details = {} }) {
  const { error } = await supabaseAdmin.from('admin_actions').insert({
    admin_id: admin?.id ?? null,
    admin_email: admin?.email ?? 'operator',
    action,
    target_type: targetType,
    target_id: targetId,
    target_label: targetLabel,
    reason,
    details,
  });
  if (error) logger.error('could not write the admin action log', { action, targetType, targetId, reason: error.message });
}

export const toAdminAction = (row) => ({
  id: row.id,
  at: row.created_at,
  admin: { id: row.admin_id, email: row.admin_email },
  action: row.action,
  target: { type: row.target_type, id: row.target_id, label: row.target_label },
  reason: row.reason ?? null,
  details: row.details ?? {},
});
