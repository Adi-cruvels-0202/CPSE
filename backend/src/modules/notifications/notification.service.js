import { supabaseAdmin } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
import { internal, notFound } from '../../lib/errors.js';
import * as events from './notification.events.js';

/**
 * In-app notifications — checklist 9.3 – 9.5.
 *
 * Rows are written by the API and polled by the client; the spec rules out
 * separate notification infrastructure, so there is no push or email fan-out.
 *
 * Emission NEVER fails the action that caused it. An order that is paid for and
 * placed must not be rolled back because a notification insert failed, so the
 * emit helpers swallow their errors into the log. Reads, which a customer is
 * waiting on, surface failures normally.
 */

const COLUMNS = 'id, customer_id, type, title, body, payload, read_at, created_at';

const fail = (error, message) => {
  if (error) throw internal(message);
};

export const toPublicNotification = (row) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body ?? null,
  payload: row.payload ?? {},
  isRead: row.read_at !== null && row.read_at !== undefined,
  readAt: row.read_at ?? null,
  createdAt: row.created_at,
});

// ── Emission ────────────────────────────────────────────────────────────────

/**
 * The single writer. Returns the row on success and null on failure, so a
 * caller can tell the difference without having to catch.
 */
export async function emit(customerId, { type, title, body = null, payload = {} }) {
  try {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .insert({ customer_id: customerId, type, title, body, payload })
      .select(COLUMNS)
      .maybeSingle();

    if (error) throw error;
    return data ?? null;
  } catch (error) {
    // Deliberately swallowed: see the note at the top of this file.
    logger.warn('Could not write a notification', {
      customerId,
      type,
      reason: error?.message ?? String(error),
    });
    return null;
  }
}

/** Called by order creation, once the order exists. */
export const notifyOrderPlaced = (order) =>
  emit(order.customer_id, events.orderPlaced(order));

/**
 * Called by `transitionOrder`, which is the only writer of `orders.status` —
 * so every status change is notified exactly once, whoever caused it.
 *
 * `pending_payment` is skipped: the customer is still sitting on the payment
 * screen and does not need to be told what they are looking at.
 */
export function notifyOrderStatus(order, toStatus, { note = null } = {}) {
  if (toStatus === 'pending_payment') return Promise.resolve(null);
  if (toStatus === 'placed' && order.status === 'pending_payment') {
    // The payment notification already says this, and two rows for one event
    // reads like a bug to the customer.
    return Promise.resolve(null);
  }
  return emit(order.customer_id, events.orderStatusChanged(order, toStatus, { note }));
}

/** Called by the payment service for every settled outcome. */
export function notifyPaymentOutcome(order, status, { failureReason = null } = {}) {
  if (status === 'paid') return emit(order.customer_id, events.paymentSucceeded(order));
  if (status === 'failed') {
    return emit(order.customer_id, events.paymentFailed(order, { reason: failureReason }));
  }
  // 'cancelled' is covered by the order-cancelled notification the transition
  // emits, and 'processing' is not news.
  return Promise.resolve(null);
}

// ── Reads (checklist 9.4) ───────────────────────────────────────────────────

/**
 * Own notifications, newest first. `customerId` comes from the verified JWT and
 * is part of the filter, so there is no way to ask for anyone else's.
 */
export async function listNotifications(customerId, { unreadOnly = false, page = 1, limit = 20 }) {
  let query = supabaseAdmin
    .from('notifications')
    .select(COLUMNS, { count: 'exact' })
    .eq('customer_id', customerId);

  if (unreadOnly) query = query.is('read_at', null);

  const from = (page - 1) * limit;
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  fail(error, 'Could not load your notifications.');

  const rows = data ?? [];
  return {
    notifications: rows.map(toPublicNotification),
    total: count ?? rows.length,
    unreadCount: await unreadCount(customerId),
  };
}

/** Powers the badge. Counts rows without fetching them. */
export async function unreadCount(customerId) {
  const { count, error } = await supabaseAdmin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .is('read_at', null);

  fail(error, 'Could not count your notifications.');
  return count ?? 0;
}

// ── Read state (checklist 9.5) ──────────────────────────────────────────────

/**
 * Marking read is idempotent: a row that is already read keeps its original
 * `read_at`, so a double tap does not rewrite history. Another customer's
 * notification is a 404, never a 403.
 */
export async function markRead(customerId, notificationId) {
  const { data: existing, error: readError } = await supabaseAdmin
    .from('notifications')
    .select(COLUMNS)
    .eq('id', notificationId)
    .eq('customer_id', customerId)
    .maybeSingle();

  fail(readError, 'Could not load the notification.');
  if (!existing) throw notFound('Notification');
  if (existing.read_at) return toPublicNotification(existing);

  const { data, error } = await supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('customer_id', customerId)
    .select(COLUMNS)
    .maybeSingle();

  fail(error, 'Could not update the notification.');
  return toPublicNotification(data ?? existing);
}

/** Marks every unread notification read. Returns how many moved. */
export async function markAllRead(customerId) {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('customer_id', customerId)
    .is('read_at', null)
    .select('id');

  fail(error, 'Could not update your notifications.');
  return { updated: (data ?? []).length, unreadCount: 0 };
}
