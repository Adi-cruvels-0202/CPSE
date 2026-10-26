import { supabaseAdmin } from '../../lib/supabase.js';
import { conflict, forbidden, internal, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { escapeSearchTerm } from '../stores/store.service.js';
import { missingForPublish } from '../merchantStores/merchantStore.service.js';
import { emitToStore } from '../notifications/merchantNotification.service.js';
import { recordAdminAction, toAdminAction } from './adminLog.js';

/**
 * The platform admin portal (migration 0045): an overview, every store, every
 * account and the log of what the admin did. The one rule that protects the
 * platform from a mistake lives here, so no route can skip it: an admin
 * account (including your own) cannot be suspended.
 */

const fail = (error, message) => {
  if (error) throw internal(message);
};

const VERIFICATION_LABELS = { not_submitted: 'Not submitted', pending: 'Waiting for review', verified: 'Verified', rejected: 'Sent back' };

// ── Overview ────────────────────────────────────────────────────────────────

async function count(table, apply = (q) => q) {
  const { count: n, error } = await apply(supabaseAdmin.from(table).select('id', { count: 'exact', head: true }));
  fail(error, `Could not count ${table}.`);
  return n ?? 0;
}

export async function overview(admin) {
  const [stores, published, pending, rejected, waitingToPublish, merchants, accounts, suspended, escalated, admins] = await Promise.all([
    count('stores'),
    count('stores', (q) => q.eq('is_published', true)),
    count('stores', (q) => q.eq('verification_status', 'pending')),
    count('stores', (q) => q.eq('verification_status', 'rejected')),
    count('stores', (q) => q.not('publish_requested_at', 'is', null).eq('is_published', false)),
    count('merchants'),
    count('customers'),
    count('customers', (q) => q.not('suspended_at', 'is', null)),
    count('conversations', (q) => q.eq('status', 'escalated')),
    count('platform_admins'),
  ]);
  const { data: recent, error } = await supabaseAdmin.from('admin_actions').select('*').order('created_at', { ascending: false }).limit(8);
  fail(error, 'Could not load recent actions.');
  return {
    you: { id: admin.id, email: admin.email },
    stores: { total: stores, published, waitingForReview: pending, sentBack: rejected, waitingToPublish },
    accounts: { total: accounts, merchants, customers: Math.max(accounts - merchants - admins, 0), suspended },
    support: { escalated },
    recentActions: (recent ?? []).map(toAdminAction),
  };
}

// ── Stores ──────────────────────────────────────────────────────────────────

const STORE_LIST_COLUMNS =
  'id, name, slug, city, shop_category, owner_id, is_published, is_active, verification_status, publish_requested_at, created_at';

async function ownersById(ids) {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('customers')
    .select('id, email, full_name, phone, suspended_at')
    .in('id', [...new Set(ids)]);
  fail(error, 'Could not load the store owners.');
  return new Map((data ?? []).map((row) => [row.id, row]));
}

const toOwner = (row) =>
  row ? { id: row.id, email: row.email, name: row.full_name ?? null, phone: row.phone ?? null, isSuspended: Boolean(row.suspended_at) } : null;

const toStoreRow = (row, owner) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  city: row.city ?? null,
  shopCategory: row.shop_category ?? null,
  isPublished: row.is_published,
  verificationStatus: row.verification_status,
  verificationLabel: VERIFICATION_LABELS[row.verification_status] ?? row.verification_status,
  publishRequestedAt: row.publish_requested_at ?? null,
  createdAt: row.created_at,
  owner: toOwner(owner),
});

export async function listStores({ search, verification, published, page = 1, limit = 20 }) {
  let query = supabaseAdmin.from('stores').select(STORE_LIST_COLUMNS, { count: 'exact' });
  if (verification) query = query.eq('verification_status', verification);
  if (published === 'yes') query = query.eq('is_published', true);
  if (published === 'no') query = query.eq('is_published', false);
  if (search) {
    const term = escapeSearchTerm(search);
    query = query.or(`name.ilike.%${term}%,slug.ilike.%${term}%,city.ilike.%${term}%`);
  }
  const from = (page - 1) * limit;
  const { data, error, count: total } = await query.order('created_at', { ascending: false }).range(from, from + limit - 1);
  fail(error, 'Could not load the stores.');
  const owners = await ownersById((data ?? []).map((row) => row.owner_id));
  return { stores: (data ?? []).map((row) => toStoreRow(row, owners.get(row.owner_id))), total: total ?? 0 };
}

async function storeRow(storeId) {
  const { data, error } = await supabaseAdmin.from('stores').select('*').eq('id', storeId).maybeSingle();
  fail(error, 'Could not load the store.');
  if (!data) throw notFound('Store');
  return data;
}

export async function storeDetail(storeId) {
  const row = await storeRow(storeId);
  const [owners, products, orders, recentOrders, log] = await Promise.all([
    ownersById([row.owner_id]),
    count('products', (q) => q.eq('store_id', storeId).is('archived_at', null)),
    count('orders', (q) => q.eq('store_id', storeId)),
    count('orders', (q) => q.eq('store_id', storeId).gte('placed_at', new Date(Date.now() - 30 * 86_400_000).toISOString())),
    supabaseAdmin.from('admin_actions').select('*').eq('target_type', 'store').eq('target_id', storeId).order('created_at', { ascending: false }).limit(20),
  ]);
  fail(log.error, 'Could not load the store history.');
  return {
    store: {
      ...toStoreRow(row, owners.get(row.owner_id)),
      phone: row.phone ?? null,
      email: row.email ?? null,
      address: [row.address_line1, row.address_line2, row.city, row.state, row.postal_code].filter(Boolean).join(', '),
      missingForPublish: missingForPublish(row),
    },
    counts: { products, orders, ordersLast30Days: recentOrders },
    actions: (log.data ?? []).map(toAdminAction),
  };
}

/**
 * Takes a published store off the platform (customers get a 404; open orders
 * carry on). Verification is untouched: the owner can publish again once the
 * problem is fixed — to stop that, revoke the verification instead.
 */
export async function unpublishStore(admin, storeId, { reason }) {
  const row = await storeRow(storeId);
  if (!row.is_published) throw conflict('This store is not published.');
  const { error } = await supabaseAdmin.from('stores').update({ is_published: false, publish_requested_at: null }).eq('id', storeId);
  fail(error, 'Could not unpublish the store.');
  await emitToStore(storeId, {
    type: 'verification_update',
    title: `${row.name} was taken off CPSE`,
    body: `${reason} Fix this and publish the store again, or contact CPSE support.`,
    payload: { store_id: storeId, unpublished_by: 'admin' },
  });
  await recordAdminAction(admin, { action: 'store_unpublished', targetType: 'store', targetId: storeId, targetLabel: row.name, reason });
  return storeDetail(storeId);
}

// ── Accounts ────────────────────────────────────────────────────────────────

const toAccount = (row) => ({
  id: row.id,
  email: row.email,
  name: row.full_name ?? null,
  phone: row.phone ?? null,
  createdAt: row.created_at,
  type: row.is_admin ? 'admin' : row.is_merchant ? 'merchant' : 'customer',
  isSuspended: Boolean(row.suspended_at),
  suspendedAt: row.suspended_at ?? null,
  suspendedReason: row.suspended_reason ?? null,
  storeCount: Number(row.store_count ?? 0),
  orderCount: Number(row.order_count ?? 0),
});

export async function listAccounts({ kind = 'all', status = 'all', search, page = 1, limit = 20 }) {
  const { data, error } = await supabaseAdmin.rpc('admin_list_accounts', {
    payload: { kind, status, search: search ?? null, limit, offset: (page - 1) * limit },
  });
  fail(error, 'Could not load the accounts.');
  return { accounts: (data?.rows ?? []).map(toAccount), total: data?.total ?? 0 };
}

async function accountRow(accountId) {
  const { data, error } = await supabaseAdmin
    .from('customers')
    .select('id, email, full_name, phone, created_at, suspended_at, suspended_reason, suspended_by')
    .eq('id', accountId)
    .maybeSingle();
  fail(error, 'Could not load the account.');
  if (!data) throw notFound('Account');
  return data;
}

async function isAdminAccount(accountId) {
  const { data, error } = await supabaseAdmin.from('platform_admins').select('id').eq('id', accountId).maybeSingle();
  fail(error, 'Could not check the account.');
  return Boolean(data);
}

export async function accountDetail(accountId) {
  const row = await accountRow(accountId);
  const [merchant, admin, stores, orders, log] = await Promise.all([
    supabaseAdmin.from('merchants').select('id').eq('id', accountId).maybeSingle(),
    supabaseAdmin.from('platform_admins').select('id').eq('id', accountId).maybeSingle(),
    supabaseAdmin.from('stores').select(STORE_LIST_COLUMNS).eq('owner_id', accountId).order('created_at', { ascending: false }),
    count('orders', (q) => q.eq('customer_id', accountId)),
    supabaseAdmin.from('admin_actions').select('*').eq('target_type', 'account').eq('target_id', accountId).order('created_at', { ascending: false }).limit(20),
  ]);
  for (const part of [merchant, admin, stores, log]) fail(part.error, 'Could not load the account.');
  return {
    account: toAccount({
      ...row,
      is_merchant: Boolean(merchant.data),
      is_admin: Boolean(admin.data),
      store_count: stores.data?.length ?? 0,
      order_count: orders,
    }),
    stores: (stores.data ?? []).map((s) => toStoreRow(s, row)),
    actions: (log.data ?? []).map(toAdminAction),
  };
}

/**
 * Supabase Auth's own ban, as well as our flag: a banned user cannot sign in
 * or refresh a session at all. The flag (checked on every request by
 * requireAuth) covers the access tokens already issued. A failed ban is
 * logged; the flag alone still refuses every request.
 */
async function setAuthBan(accountId, banned) {
  const api = supabaseAdmin.auth?.admin;
  if (typeof api?.updateUserById !== 'function') return;
  const { error } = await api.updateUserById(accountId, { ban_duration: banned ? '876000h' : 'none' });
  if (error) logger.error('could not update the auth ban', { accountId, banned, reason: error.message });
}

export async function suspendAccount(admin, accountId, { reason }) {
  if (accountId === admin.id) throw forbidden('You cannot suspend your own account.');
  const row = await accountRow(accountId);
  if (await isAdminAccount(accountId)) throw forbidden('This account is a platform admin. Remove it as an admin before suspending it.');
  if (row.suspended_at) throw conflict('This account is already suspended.');
  const { error } = await supabaseAdmin
    .from('customers')
    .update({ suspended_at: new Date().toISOString(), suspended_reason: reason, suspended_by: admin.id })
    .eq('id', accountId);
  fail(error, 'Could not suspend the account.');
  await setAuthBan(accountId, true);
  await recordAdminAction(admin, { action: 'account_suspended', targetType: 'account', targetId: accountId, targetLabel: row.email, reason });
  return accountDetail(accountId);
}

export async function reinstateAccount(admin, accountId, { reason }) {
  const row = await accountRow(accountId);
  if (!row.suspended_at) throw conflict('This account is not suspended.');
  const { error } = await supabaseAdmin
    .from('customers')
    .update({ suspended_at: null, suspended_reason: null, suspended_by: null })
    .eq('id', accountId);
  fail(error, 'Could not reinstate the account.');
  await setAuthBan(accountId, false);
  await recordAdminAction(admin, { action: 'account_reinstated', targetType: 'account', targetId: accountId, targetLabel: row.email, reason });
  return accountDetail(accountId);
}

// ── Log ─────────────────────────────────────────────────────────────────────

export async function listActions({ targetType, action, page = 1, limit = 30 }) {
  let query = supabaseAdmin.from('admin_actions').select('*', { count: 'exact' });
  if (targetType) query = query.eq('target_type', targetType);
  if (action) query = query.eq('action', action);
  const from = (page - 1) * limit;
  const { data, error, count: total } = await query.order('created_at', { ascending: false }).range(from, from + limit - 1);
  fail(error, 'Could not load the log.');
  return { actions: (data ?? []).map(toAdminAction), total: total ?? 0 };
}
