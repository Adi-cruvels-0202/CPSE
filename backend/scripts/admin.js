/**
 * Platform admins from the command line — how the first admin is made, and
 * the way back in if every superadmin is locked out. After that, superadmins
 * manage admins in the portal (/merchant/admin → Admins).
 *
 *   npm run admin -- list
 *   npm run admin -- grant  <email> [superadmin|reviewer|support]   (default superadmin)
 *   npm run admin -- role   <email> <superadmin|reviewer|support>
 *   npm run admin -- revoke <email>
 *
 * The account must already exist (signed up in the customer app) and must not
 * be a shop account: admins sign in to the portal with their own login.
 * Every change is written to the admin action log as "operator".
 */
import { supabaseAdmin } from '../src/lib/supabase.js';
import { recordAdminAction } from '../src/modules/admin/adminLog.js';
import { ADMIN_ROLES } from '../src/middleware/requireAdmin.js';

const OPERATOR = { id: null, email: 'operator (scripts/admin.js)' };

function stop(message) {
  console.error(message);
  process.exit(1);
}

async function account(email) {
  const { data, error } = await supabaseAdmin.from('customers').select('id, email, full_name, suspended_at').eq('email', email.toLowerCase()).maybeSingle();
  if (error) stop(`Could not look up ${email}: ${error.message}`);
  if (!data) stop(`No account uses ${email}. Sign up in the customer app first, then run this again.`);
  return data;
}

async function adminFor(id) {
  const { data, error } = await supabaseAdmin.from('platform_admins').select('id, email, role').eq('id', id).maybeSingle();
  if (error) stop(`Could not read platform_admins: ${error.message}`);
  return data;
}

async function superadmins() {
  const { count, error } = await supabaseAdmin.from('platform_admins').select('id', { count: 'exact', head: true }).eq('role', 'superadmin');
  if (error) stop(error.message);
  return count ?? 0;
}

const [command, email, roleArg] = process.argv.slice(2);

if (command === 'list') {
  const { data, error } = await supabaseAdmin.from('platform_admins').select('email, role, created_at').order('created_at');
  if (error) stop(error.message);
  if (!data.length) console.log('No admins yet. Make one with: npm run admin -- grant <email>');
  for (const row of data) console.log(`${row.role.padEnd(11)} ${row.email}  (since ${String(row.created_at).slice(0, 10)})`);
} else if (command === 'grant') {
  if (!email) stop('Usage: npm run admin -- grant <email> [superadmin|reviewer|support]');
  const role = roleArg ?? 'superadmin';
  if (!ADMIN_ROLES.includes(role)) stop(`Role must be one of: ${ADMIN_ROLES.join(', ')}`);
  const user = await account(email);
  if (user.suspended_at) stop(`${email} is suspended. Reinstate it first.`);
  const { data: merchant } = await supabaseAdmin.from('merchants').select('id').eq('id', user.id).maybeSingle();
  if (merchant) stop(`${email} is a shop account. Admins need their own account, separate from any shop.`);
  if (await adminFor(user.id)) stop(`${email} is already an admin. Use "role" to change the role.`);
  const { error } = await supabaseAdmin.from('platform_admins').insert({ id: user.id, email: user.email, full_name: user.full_name ?? null, role });
  if (error) stop(`Could not add the admin: ${error.message}`);
  await recordAdminAction(OPERATOR, { action: 'admin_added', targetType: 'admin', targetId: user.id, targetLabel: user.email, details: { role } });
  console.log(`${email} is now a ${role}. Sign in at /merchant/admin.`);
} else if (command === 'role') {
  if (!email || !ADMIN_ROLES.includes(roleArg)) stop(`Usage: npm run admin -- role <email> <${ADMIN_ROLES.join('|')}>`);
  const user = await account(email);
  const current = await adminFor(user.id);
  if (!current) stop(`${email} is not an admin.`);
  if (current.role === 'superadmin' && roleArg !== 'superadmin' && (await superadmins()) <= 1) stop('That is the only superadmin. Make someone else a superadmin first.');
  const { error } = await supabaseAdmin.from('platform_admins').update({ role: roleArg }).eq('id', user.id);
  if (error) stop(error.message);
  await recordAdminAction(OPERATOR, { action: 'admin_role_changed', targetType: 'admin', targetId: user.id, targetLabel: user.email, details: { from: current.role, to: roleArg } });
  console.log(`${email}: ${current.role} → ${roleArg}`);
} else if (command === 'revoke') {
  if (!email) stop('Usage: npm run admin -- revoke <email>');
  const user = await account(email);
  const current = await adminFor(user.id);
  if (!current) stop(`${email} is not an admin.`);
  if (current.role === 'superadmin' && (await superadmins()) <= 1) stop('That is the only superadmin. Make someone else a superadmin first.');
  const { error } = await supabaseAdmin.from('platform_admins').delete().eq('id', user.id);
  if (error) stop(error.message);
  await recordAdminAction(OPERATOR, { action: 'admin_removed', targetType: 'admin', targetId: user.id, targetLabel: user.email, reason: 'Removed from the command line', details: { role: current.role } });
  console.log(`${email} is no longer an admin.`);
} else {
  stop('Commands: list | grant <email> [role] | role <email> <role> | revoke <email>');
}
