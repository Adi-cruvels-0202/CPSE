/**
 * Platform admins from the command line. The admin portal (/admin) is run by
 * one admin who can do everything; this is how that admin is made.
 *
 *   npm run admin -- list
 *   npm run admin -- grant  <email>
 *   npm run admin -- revoke <email>
 *
 * The account must already exist (signed up in the customer app) and must not
 * be a shop account: the admin signs in to the portal with their own login.
 * Every change is written to the admin action log as "operator".
 */
import { supabaseAdmin } from '../src/lib/supabase.js';
import { recordAdminAction } from '../src/modules/admin/adminLog.js';

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

async function isAdmin(id) {
  const { data, error } = await supabaseAdmin.from('platform_admins').select('id').eq('id', id).maybeSingle();
  if (error) stop(`Could not read platform_admins: ${error.message}`);
  return Boolean(data);
}

const [command, email] = process.argv.slice(2);

if (command === 'list') {
  const { data, error } = await supabaseAdmin.from('platform_admins').select('email, created_at').order('created_at');
  if (error) stop(error.message);
  if (!data.length) console.log('No admin yet. Make one with: npm run admin -- grant <email>');
  for (const row of data) console.log(`${row.email}  (since ${String(row.created_at).slice(0, 10)})`);
} else if (command === 'grant') {
  if (!email) stop('Usage: npm run admin -- grant <email>');
  const user = await account(email);
  if (user.suspended_at) stop(`${email} is suspended. Reinstate it first.`);
  const { data: merchant } = await supabaseAdmin.from('merchants').select('id').eq('id', user.id).maybeSingle();
  if (merchant) stop(`${email} is a shop account. The admin needs their own account, separate from any shop.`);
  if (await isAdmin(user.id)) stop(`${email} is already an admin.`);
  const { error } = await supabaseAdmin.from('platform_admins').insert({ id: user.id, email: user.email, full_name: user.full_name ?? null });
  if (error) stop(`Could not add the admin: ${error.message}`);
  await recordAdminAction(OPERATOR, { action: 'admin_added', targetType: 'admin', targetId: user.id, targetLabel: user.email });
  console.log(`${email} is now an admin. Sign in at /admin.`);
} else if (command === 'revoke') {
  if (!email) stop('Usage: npm run admin -- revoke <email>');
  const user = await account(email);
  if (!(await isAdmin(user.id))) stop(`${email} is not an admin.`);
  const { error } = await supabaseAdmin.from('platform_admins').delete().eq('id', user.id);
  if (error) stop(error.message);
  await recordAdminAction(OPERATOR, { action: 'admin_removed', targetType: 'admin', targetId: user.id, targetLabel: user.email, reason: 'Removed from the command line' });
  console.log(`${email} is no longer an admin.`);
} else {
  stop('Commands: list | grant <email> | revoke <email>');
}
