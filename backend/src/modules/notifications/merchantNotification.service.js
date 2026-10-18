import { supabaseAdmin } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
import { internal, notFound } from '../../lib/errors.js';

/**
 * A store's inbox (migration 0036). Written by the API and the background
 * jobs, read by the merchant app. Like customer notifications, emitting never
 * fails the action that caused it.
 *
 * `dedupeKey` collapses repeats of one condition — a low-stock alert per
 * variant per day — so a job that runs every minute writes one row, not 1,440.
 */

const COLUMNS = 'id, store_id, merchant_id, type, title, body, payload, dedupe_key, read_at, created_at';

export const toPublicMerchantNotification = (row) => ({
  id: row.id,
  storeId: row.store_id,
  type: row.type,
  title: row.title,
  body: row.body ?? null,
  payload: row.payload ?? {},
  isRead: Boolean(row.read_at),
  readAt: row.read_at ?? null,
  createdAt: row.created_at,
});

async function ownerOf(storeId) {
  const { data, error } = await supabaseAdmin.from('stores').select('id, owner_id').eq('id', storeId).maybeSingle();
  if (error) throw error;
  return data?.owner_id ?? null;
}

/** Returns the row, or null when it was a duplicate, the store has no owner, or the write failed. */
export async function emitToStore(storeId, { type, title, body = null, payload = {}, dedupeKey = null }) {
  try {
    const merchantId = await ownerOf(storeId);
    if (!merchantId) return null;

    if (dedupeKey) {
      const { data: existing, error } = await supabaseAdmin
        .from('merchant_notifications')
        .select('id')
        .eq('store_id', storeId)
        .eq('dedupe_key', dedupeKey)
        .maybeSingle();
      if (error) throw error;
      if (existing) return null;
    }

    const { data, error } = await supabaseAdmin
      .from('merchant_notifications')
      .insert({ store_id: storeId, merchant_id: merchantId, type, title, body, payload, dedupe_key: dedupeKey })
      .select(COLUMNS)
      .maybeSingle();
    // A racing duplicate lost on the unique index — the alert exists already.
    if (error?.code === '23505') return null;
    if (error) throw error;
    return data ?? null;
  } catch (error) {
    logger.warn('Could not write a merchant notification', { storeId, type, reason: error?.message ?? String(error) });
    return null;
  }
}

export async function listForStore(store, { unreadOnly = false, page = 1, limit = 20 }) {
  let query = supabaseAdmin
    .from('merchant_notifications')
    .select(COLUMNS, { count: 'exact' })
    .eq('store_id', store.id);
  if (unreadOnly) query = query.is('read_at', null);

  const from = (page - 1) * limit;
  const { data, count, error } = await query.order('created_at', { ascending: false }).range(from, from + limit - 1);
  if (error) throw internal('Could not load notifications.');

  const unread = await supabaseAdmin
    .from('merchant_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', store.id)
    .is('read_at', null);
  if (unread.error) throw internal('Could not count notifications.');

  return {
    notifications: (data ?? []).map(toPublicMerchantNotification),
    total: count ?? 0,
    unreadCount: unread.count ?? 0,
  };
}

export async function markRead(store, notificationId) {
  const { data: existing, error } = await supabaseAdmin
    .from('merchant_notifications')
    .select(COLUMNS)
    .eq('id', notificationId)
    .eq('store_id', store.id)
    .maybeSingle();
  if (error) throw internal('Could not load the notification.');
  if (!existing) throw notFound('Notification');
  if (existing.read_at) return toPublicMerchantNotification(existing);

  const { data, error: updateError } = await supabaseAdmin
    .from('merchant_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('store_id', store.id)
    .select(COLUMNS)
    .maybeSingle();
  if (updateError) throw internal('Could not update the notification.');
  return toPublicMerchantNotification(data ?? existing);
}

export async function markAllRead(store) {
  const { data, error } = await supabaseAdmin
    .from('merchant_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('store_id', store.id)
    .is('read_at', null)
    .select('id');
  if (error) throw internal('Could not update notifications.');
  return { updated: (data ?? []).length, unreadCount: 0 };
}
