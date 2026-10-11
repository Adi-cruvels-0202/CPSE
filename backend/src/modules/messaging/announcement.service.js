import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, tooManyRequests } from '../../lib/errors.js';
import * as notifications from '../notifications/notification.service.js';

/**
 * Store-specific notifications — roadmap §5 P3: opted-in customers hear about
 * relevant merchant activity. An announcement reaches only customers who
 * follow (saved) the store AND turned promotions on for it. A handful a day,
 * at most, so following a shop never becomes a stream of noise.
 */

export const MAX_ANNOUNCEMENTS_PER_DAY = 3;

const fail = (error, message) => {
  if (error) throw internal(message);
};

export async function audienceSize(store) {
  const recipients = await recipientsFor(store);
  return { followers: recipients.followers, optedIn: recipients.optedIn.length };
}

async function recipientsFor(store) {
  const { data: followers, error } = await supabaseAdmin.from('saved_stores').select('customer_id').eq('store_id', store.id);
  fail(error, 'Could not load followers.');
  const ids = (followers ?? []).map((row) => row.customer_id);
  if (ids.length === 0) return { followers: 0, optedIn: [] };
  const { data: prefs, error: prefError } = await supabaseAdmin
    .from('customer_store_preferences')
    .select('customer_id, allow_promotions')
    .eq('store_id', store.id)
    .in('customer_id', ids);
  fail(prefError, 'Could not load preferences.');
  return { followers: ids.length, optedIn: (prefs ?? []).filter((p) => p.allow_promotions).map((p) => p.customer_id) };
}

export async function listAnnouncements(store) {
  const { data, error } = await supabaseAdmin
    .from('store_announcements')
    .select('id, title, body, recipient_count, created_at')
    .eq('store_id', store.id)
    .order('created_at', { ascending: false })
    .limit(50);
  fail(error, 'Could not load announcements.');
  return (data ?? []).map((row) => ({ id: row.id, title: row.title, body: row.body ?? null, recipientCount: row.recipient_count, sentAt: row.created_at }));
}

export async function announce(store, merchant, { title, body }) {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data: recent, error: recentError } = await supabaseAdmin
    .from('store_announcements')
    .select('id')
    .eq('store_id', store.id)
    .gte('created_at', since);
  fail(recentError, 'Could not send the announcement.');
  if ((recent ?? []).length >= MAX_ANNOUNCEMENTS_PER_DAY) {
    throw tooManyRequests(`At most ${MAX_ANNOUNCEMENTS_PER_DAY} announcements a day, so followers keep listening.`);
  }

  const { optedIn } = await recipientsFor(store);
  const { data, error } = await supabaseAdmin
    .from('store_announcements')
    .insert({ store_id: store.id, title, body: body ?? null, created_by: merchant.id, recipient_count: optedIn.length })
    .select('id, title, body, recipient_count, created_at')
    .maybeSingle();
  fail(error, 'Could not send the announcement.');

  for (const customerId of optedIn) {
    await notifications.emit(customerId, {
      type: 'store_update',
      title: `${store.name}: ${title}`,
      body: body ?? null,
      payload: { store_id: store.id, store_slug: store.slug, announcement_id: data.id },
    });
  }
  return { id: data.id, title: data.title, body: data.body ?? null, recipientCount: data.recipient_count, sentAt: data.created_at };
}
