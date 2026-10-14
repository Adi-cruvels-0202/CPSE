import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, notFound, conflict } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { localDate, addDays } from '../../lib/khataAgeing.js';
import { batchExpiryState } from '../merchantInventory/inventory.service.js';
import { emitToStore } from '../notifications/merchantNotification.service.js';
import * as notifications from '../notifications/notification.service.js';
import { remindOverdue } from '../merchantKhata/merchantKhata.service.js';

/**
 * Merchant automation — roadmap Phase C: low-stock alerts, expiry alerts,
 * notifications, recurring operations and deterministic suggested purchase
 * lists; §5 P4 reorder reminders.
 *
 * Every job here is idempotent and safe to run again or from two schedulers
 * at once: alerts carry a dedupe key, reminders are recorded once per cycle,
 * and state changes are guarded updates. Automation proposes; it never
 * changes stock, prices or money on its own.
 */

const fail = (error, message) => {
  if (error) throw internal(message);
};

async function activeStores() {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select('id, name, slug, timezone, owner_id, expiry_alert_days, khata_auto_reminders, is_active')
    .eq('is_active', true);
  fail(error, 'Could not load stores.');
  return (data ?? []).filter((store) => store.owner_id);
}

// ── Low stock ───────────────────────────────────────────────────────────────

/** Tracked, active variants at or under their product's threshold, as of now. */
export async function lowStockFor(store) {
  const { data: products, error } = await supabaseAdmin
    .from('products')
    .select('id, name, low_stock_threshold, track_inventory, is_available')
    .eq('store_id', store.id)
    .is('archived_at', null)
    .eq('track_inventory', true);
  fail(error, 'Could not load products.');
  const watched = (products ?? []).filter((p) => p.is_available && p.low_stock_threshold !== null);
  if (watched.length === 0) return [];
  const { data: variants, error: variantError } = await supabaseAdmin
    .from('product_variants')
    .select('id, product_id, name, sku, quantity_on_hand, reserved_quantity, is_available')
    .in('product_id', watched.map((p) => p.id));
  fail(variantError, 'Could not load variants.');
  const byId = new Map(watched.map((p) => [p.id, p]));
  return (variants ?? [])
    .filter((v) => v.is_available)
    .map((v) => ({ variant: v, product: byId.get(v.product_id), available: v.quantity_on_hand - v.reserved_quantity }))
    .filter(({ product, available }) => available <= product.low_stock_threshold)
    .sort((a, b) => a.available - b.available);
}

export async function runLowStockAlerts({ now = new Date() } = {}) {
  let alerts = 0;
  for (const store of await activeStores()) {
    const today = localDate(now, store.timezone);
    for (const { variant, product, available } of await lowStockFor(store)) {
      const label = variant.name === 'Default' ? product.name : `${product.name} (${variant.name})`;
      const row = await emitToStore(store.id, {
        type: 'low_stock',
        title: available <= 0 ? `Out of stock: ${label}` : `Low stock: ${label}`,
        body: `${Math.max(available, 0)} left to sell; your alert level is ${product.low_stock_threshold}.`,
        payload: { product_id: product.id, variant_id: variant.id, available },
        // One alert per variant per day, however often the job runs.
        dedupeKey: `low_stock:${variant.id}:${today}`,
      });
      if (row) alerts += 1;
    }
  }
  return { alerts };
}

// ── Expiry ──────────────────────────────────────────────────────────────────

export async function runExpiryAlerts({ now = new Date() } = {}) {
  let alerts = 0;
  for (const store of await activeStores()) {
    const { data: batches, error } = await supabaseAdmin
      .from('inventory_batches')
      .select('id, product_id, variant_id, batch_number, expires_on, quantity_remaining')
      .eq('store_id', store.id)
      .gt('quantity_remaining', 0);
    fail(error, 'Could not load batches.');
    const today = localDate(now, store.timezone);
    const products = new Map();
    const productIds = [...new Set((batches ?? []).map((b) => b.product_id))];
    if (productIds.length) {
      const { data } = await supabaseAdmin.from('products').select('id, name').in('id', productIds);
      for (const p of data ?? []) products.set(p.id, p.name);
    }
    for (const batch of batches ?? []) {
      const state = batchExpiryState(batch.expires_on, today, store.expiry_alert_days ?? 30);
      if (state !== 'expiring' && state !== 'expired') continue;
      const name = products.get(batch.product_id) ?? 'A product';
      const row = await emitToStore(store.id, {
        type: state === 'expired' ? 'batch_expired' : 'batch_expiring',
        title: state === 'expired' ? `Expired: ${name}` : `Expiring ${batch.expires_on}: ${name}`,
        body:
          state === 'expired'
            ? `${batch.quantity_remaining} of batch ${batch.batch_number ?? '(unnumbered)'} expired on ${batch.expires_on}. Write it off from Stock.`
            : `${batch.quantity_remaining} of batch ${batch.batch_number ?? '(unnumbered)'} expire on ${batch.expires_on}. Consider a local offer.`,
        payload: { batch_id: batch.id, product_id: batch.product_id, variant_id: batch.variant_id, expires_on: batch.expires_on },
        dedupeKey: `${state === 'expired' ? 'batch_expired' : 'batch_expiring'}:${batch.id}`,
      });
      if (row) alerts += 1;
    }
  }
  return { alerts };
}

// ── Khata reminders (opt-in per store) ──────────────────────────────────────

export async function runKhataReminders({ now = new Date() } = {}) {
  let sent = 0;
  for (const store of (await activeStores()).filter((s) => s.khata_auto_reminders)) {
    sent += await remindOverdue({ ...store }, { now });
  }
  return { sent };
}

// ── Reorder and template reminders (customer) ───────────────────────────────

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * A reminder when a routine purchase looks due: a product bought in three or
 * more completed orders at a store, whose usual gap (median days between
 * purchases) has passed since the last one. Only for customers who have not
 * turned reminders off for that store; once per cycle.
 */
export async function runReorderReminders({ now = new Date() } = {}) {
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select('id, customer_id, store_id, completed_at')
    .eq('status', 'completed')
    .gte('completed_at', new Date(now.getTime() - 365 * 86_400_000).toISOString());
  fail(error, 'Could not load orders.');
  const rows = orders ?? [];
  if (rows.length === 0) return { sent: 0 };

  const { data: items, error: itemError } = await supabaseAdmin
    .from('order_items')
    .select('order_id, product_id, product_name')
    .in('order_id', rows.map((o) => o.id));
  fail(itemError, 'Could not load order items.');
  const orderById = new Map(rows.map((o) => [o.id, o]));

  const groups = new Map();
  for (const item of items ?? []) {
    if (!item.product_id) continue;
    const order = orderById.get(item.order_id);
    const key = `${order.customer_id}|${order.store_id}|${item.product_id}`;
    const entry = groups.get(key) ?? { order, name: item.product_name, dates: new Set() };
    entry.dates.add(order.completed_at.slice(0, 10));
    groups.set(key, entry);
  }

  let sent = 0;
  const prefsCache = new Map();
  for (const [key, entry] of groups) {
    const dates = [...entry.dates].sort();
    if (dates.length < 3) continue;
    const gaps = dates.slice(1).map((d, i) => (Date.parse(d) - Date.parse(dates[i])) / 86_400_000);
    const usual = Math.round(median(gaps));
    if (usual < 1) continue;
    const dueOn = addDays(dates.at(-1), usual);
    if (dueOn > now.toISOString().slice(0, 10)) continue;

    const [customerId, storeId, productId] = key.split('|');
    const prefKey = `${customerId}|${storeId}`;
    if (!prefsCache.has(prefKey)) {
      const { data } = await supabaseAdmin
        .from('customer_store_preferences')
        .select('allow_reminders')
        .eq('customer_id', customerId)
        .eq('store_id', storeId)
        .maybeSingle();
      prefsCache.set(prefKey, data?.allow_reminders ?? true);
    }
    if (!prefsCache.get(prefKey)) continue;

    const { error: insertError } = await supabaseAdmin
      .from('customer_reminders')
      .insert({ customer_id: customerId, store_id: storeId, product_id: productId, kind: 'reorder', due_on: dueOn });
    if (insertError?.code === '23505') continue;
    fail(insertError, 'Could not record the reminder.');
    await notifications.emit(customerId, {
      type: 'reorder_reminder',
      title: `Time for ${entry.name} again?`,
      body: `You usually buy it every ${usual} days. Tap to reorder.`,
      payload: { store_id: storeId, product_id: productId },
    });
    sent += 1;
  }

  // Recurring templates whose reminder date has come.
  const today = now.toISOString().slice(0, 10);
  const { data: templates } = await supabaseAdmin
    .from('shopping_lists')
    .select('id, customer_id, store_id, name, repeat_every_days, next_reminder_on')
    .eq('kind', 'template')
    .lte('next_reminder_on', today);
  for (const template of templates ?? []) {
    if (!template.repeat_every_days) continue;
    const { error: insertError } = await supabaseAdmin
      .from('customer_reminders')
      .insert({ customer_id: template.customer_id, store_id: template.store_id, list_id: template.id, kind: 'template', due_on: template.next_reminder_on });
    if (insertError?.code !== '23505') {
      fail(insertError, 'Could not record the reminder.');
      await notifications.emit(template.customer_id, {
        type: 'reorder_reminder',
        title: `Your "${template.name}" basket is due`,
        body: 'Tap to add it to your cart.',
        payload: { store_id: template.store_id, list_id: template.id },
      });
      sent += 1;
    }
    await supabaseAdmin
      .from('shopping_lists')
      .update({ next_reminder_on: addDays(template.next_reminder_on, template.repeat_every_days) })
      .eq('id', template.id)
      .eq('next_reminder_on', template.next_reminder_on);
  }
  return { sent };
}

// ── Points expiry ───────────────────────────────────────────────────────────

/**
 * Points not spent within the programme's expiry period lapse: whatever was
 * earned before the cut-off, minus everything already spent or expired, is
 * expired now (first earned, first spent). Idempotent: a second run finds
 * nothing left to expire.
 */
export async function runPointsExpiry({ now = new Date() } = {}) {
  const { data: all, error } = await supabaseAdmin.from('loyalty_programs').select('store_id, points_expire_days, is_active');
  fail(error, 'Could not load programmes.');
  let expired = 0;
  for (const program of (all ?? []).filter((p) => p.points_expire_days)) {
    const cutoff = new Date(now.getTime() - program.points_expire_days * 86_400_000).toISOString();
    const { data: ledger, error: ledgerError } = await supabaseAdmin
      .from('loyalty_ledger')
      .select('customer_id, kind, points, created_at')
      .eq('store_id', program.store_id);
    fail(ledgerError, 'Could not load points.');
    const byCustomer = new Map();
    for (const row of ledger ?? []) {
      const entry = byCustomer.get(row.customer_id) ?? { oldEarned: 0, spent: 0 };
      if (row.points > 0 && row.created_at < cutoff && row.kind !== 'reverse_redeem') entry.oldEarned += row.points;
      // Spending (and expiring) counts up; points handed back count down.
      if (row.points < 0 || row.kind === 'reverse_redeem') entry.spent -= row.points;
      byCustomer.set(row.customer_id, entry);
    }
    for (const [customerId, { oldEarned, spent }] of byCustomer) {
      const lapse = oldEarned - spent;
      if (lapse <= 0) continue;
      const { error: postError } = await supabaseAdmin.rpc('post_loyalty_points', {
        p_store_id: program.store_id,
        p_customer_id: customerId,
        p_kind: 'expire',
        p_points: -lapse,
        p_order_id: null,
        p_reward_id: null,
        p_note: `Points earned before ${cutoff.slice(0, 10)} expired`,
        p_created_by_type: 'system',
        p_created_by_id: null,
      });
      if (postError) {
        logger.warn('Could not expire points', { storeId: program.store_id, customerId, message: postError.message });
        continue;
      }
      expired += lapse;
    }
  }
  return { expired };
}

// ── Suggested purchase list (deterministic) ─────────────────────────────────

/**
 * What to reorder, and how much: enough to cover `coverDays` of the recent
 * selling rate (orders fulfilled plus counter sales over `lookbackDays`), and
 * never less than one above the low-stock level — minus what is available now
 * and what is already on a draft purchase. Every line says why.
 */
export async function purchaseSuggestions(store, { now = new Date(), coverDays = 14, lookbackDays = 30 } = {}) {
  const since = new Date(now.getTime() - lookbackDays * 86_400_000).toISOString();
  const [products, movements, drafts] = await Promise.all([
    supabaseAdmin
      .from('products')
      .select('id, name, low_stock_threshold, track_inventory, is_available')
      .eq('store_id', store.id)
      .is('archived_at', null)
      .eq('track_inventory', true),
    supabaseAdmin
      .from('inventory_ledger')
      .select('variant_id, movement_type, on_hand_change, created_at')
      .eq('store_id', store.id)
      .in('movement_type', ['order_fulfilled', 'sale'])
      .gte('created_at', since),
    supabaseAdmin.from('purchases').select('id').eq('store_id', store.id).eq('status', 'draft'),
  ]);
  fail(products.error || movements.error || drafts.error, 'Could not build suggestions.');
  const live = (products.data ?? []).filter((p) => p.is_available);
  if (live.length === 0) return { coverDays, lookbackDays, suggestions: [] };

  const { data: variants, error } = await supabaseAdmin
    .from('product_variants')
    .select('id, product_id, name, sku, quantity_on_hand, reserved_quantity, cost_paise, is_available')
    .in('product_id', live.map((p) => p.id));
  fail(error, 'Could not build suggestions.');

  const sold = new Map();
  for (const m of movements.data ?? []) sold.set(m.variant_id, (sold.get(m.variant_id) ?? 0) - m.on_hand_change);

  const incoming = new Map();
  const draftIds = (drafts.data ?? []).map((d) => d.id);
  if (draftIds.length) {
    const { data: lines } = await supabaseAdmin.from('purchase_items').select('variant_id, quantity').in('purchase_id', draftIds);
    for (const line of lines ?? []) incoming.set(line.variant_id, (incoming.get(line.variant_id) ?? 0) + line.quantity);
  }

  const productById = new Map(live.map((p) => [p.id, p]));
  const suggestions = [];
  for (const variant of (variants ?? []).filter((v) => v.is_available)) {
    const product = productById.get(variant.product_id);
    const unitsSold = sold.get(variant.id) ?? 0;
    const perDay = unitsSold / lookbackDays;
    const available = variant.quantity_on_hand - variant.reserved_quantity;
    const floor = product.low_stock_threshold === null ? 0 : product.low_stock_threshold + 1;
    const target = Math.max(Math.ceil(perDay * coverDays), floor);
    const onOrder = incoming.get(variant.id) ?? 0;
    const quantity = target - available - onOrder;
    if (quantity <= 0) continue;
    suggestions.push({
      productId: product.id,
      productName: product.name,
      variantId: variant.id,
      variantName: variant.name === 'Default' ? null : variant.name,
      sku: variant.sku ?? null,
      available,
      onDraftPurchases: onOrder,
      soldLastPeriod: unitsSold,
      dailyRate: Math.round(perDay * 100) / 100,
      suggestedQuantity: quantity,
      lastCostPaise: variant.cost_paise ?? null,
      estimatedCostPaise: variant.cost_paise === null ? null : variant.cost_paise * quantity,
      reason:
        unitsSold > 0
          ? `Sold ${unitsSold} in ${lookbackDays} days (${(Math.round(perDay * 100) / 100).toString()}/day); ${coverDays} days of cover needs ${target}, ${available} available${onOrder ? `, ${onOrder} on draft purchases` : ''}.`
          : `At or below your low-stock level of ${product.low_stock_threshold}; ${available} available.`,
    });
  }
  suggestions.sort((a, b) => a.available - b.available || b.dailyRate - a.dailyRate);
  return { coverDays, lookbackDays, suggestions };
}

// ── Recurring operations ────────────────────────────────────────────────────

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The UTC instant of HH:MM on a local date in a timezone. */
function zonedInstant(isoDate, time, timeZone) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess - (asLocal - guess));
}

/** The next time a task should run after `after`, in the store's timezone. */
export function nextRunAfter(task, timeZone, after) {
  let date = localDate(after, timeZone);
  for (let i = 0; i < 400; i += 1) {
    const candidate = zonedInstant(date, task.time_of_day, timeZone);
    const weekday = WEEKDAY[new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(candidate)];
    const dayOfMonth = Number(date.split('-')[2]);
    const matches =
      task.frequency === 'daily' ||
      (task.frequency === 'weekly' && weekday === task.day_of_week) ||
      (task.frequency === 'monthly' && dayOfMonth === task.day_of_month);
    if (matches && candidate > after) return candidate;
    date = addDays(date, 1);
  }
  throw internal('Could not schedule the task.');
}

const TASK_COLUMNS = 'id, store_id, title, task_type, frequency, day_of_week, day_of_month, time_of_day, is_active, next_run_at, last_run_at, created_at';

const toTask = (row) => ({
  id: row.id,
  title: row.title,
  taskType: row.task_type,
  frequency: row.frequency,
  dayOfWeek: row.day_of_week ?? null,
  dayOfMonth: row.day_of_month ?? null,
  timeOfDay: row.time_of_day,
  isActive: row.is_active,
  nextRunAt: row.next_run_at,
  lastRunAt: row.last_run_at ?? null,
});

export async function listTasks(store) {
  const { data, error } = await supabaseAdmin.from('recurring_tasks').select(TASK_COLUMNS).eq('store_id', store.id).order('next_run_at', { ascending: true });
  fail(error, 'Could not load tasks.');
  return (data ?? []).map(toTask);
}

export async function createTask(store, merchant, input, { now = new Date() } = {}) {
  const row = {
    store_id: store.id,
    title: input.title,
    task_type: input.taskType,
    frequency: input.frequency,
    day_of_week: input.frequency === 'weekly' ? input.dayOfWeek : null,
    day_of_month: input.frequency === 'monthly' ? input.dayOfMonth : null,
    time_of_day: input.timeOfDay ?? '09:00',
    created_by: merchant.id,
  };
  row.next_run_at = nextRunAfter(row, store.timezone, now).toISOString();
  const { data, error } = await supabaseAdmin.from('recurring_tasks').insert(row).select(TASK_COLUMNS).maybeSingle();
  fail(error, 'Could not create the task.');
  return toTask(data);
}

export async function updateTask(store, taskId, input, { now = new Date() } = {}) {
  const { data: existing, error } = await supabaseAdmin.from('recurring_tasks').select(TASK_COLUMNS).eq('id', taskId).eq('store_id', store.id).maybeSingle();
  fail(error, 'Could not load the task.');
  if (!existing) throw notFound('Task');
  const row = { ...existing };
  if (input.title !== undefined) row.title = input.title;
  if (input.isActive !== undefined) row.is_active = input.isActive;
  if (input.timeOfDay !== undefined) row.time_of_day = input.timeOfDay;
  if (input.frequency !== undefined) {
    row.frequency = input.frequency;
    row.day_of_week = input.frequency === 'weekly' ? input.dayOfWeek ?? existing.day_of_week : null;
    row.day_of_month = input.frequency === 'monthly' ? input.dayOfMonth ?? existing.day_of_month : null;
  }
  if (row.frequency === 'weekly' && row.day_of_week === null) throw conflict('A weekly task needs a day of the week.');
  if (row.frequency === 'monthly' && row.day_of_month === null) throw conflict('A monthly task needs a day of the month.');
  const patch = {
    title: row.title,
    is_active: row.is_active,
    time_of_day: row.time_of_day,
    frequency: row.frequency,
    day_of_week: row.day_of_week,
    day_of_month: row.day_of_month,
    next_run_at: nextRunAfter(row, store.timezone, now).toISOString(),
  };
  const { data, error: updateError } = await supabaseAdmin.from('recurring_tasks').update(patch).eq('id', taskId).select(TASK_COLUMNS).maybeSingle();
  fail(updateError, 'Could not update the task.');
  return toTask(data);
}

export async function deleteTask(store, taskId) {
  const { data, error } = await supabaseAdmin.from('recurring_tasks').delete().eq('id', taskId).eq('store_id', store.id).select('id').maybeSingle();
  fail(error, 'Could not delete the task.');
  if (!data) throw notFound('Task');
}

async function taskReport(store, task, now) {
  switch (task.task_type) {
    case 'low_stock_report': {
      const rows = await lowStockFor(store);
      return rows.length
        ? `${rows.length} item${rows.length === 1 ? '' : 's'} at or below the alert level: ${rows.slice(0, 5).map((r) => r.product.name).join(', ')}${rows.length > 5 ? '…' : ''}.`
        : 'Nothing is low on stock.';
    }
    case 'expiry_report': {
      const { data } = await supabaseAdmin.from('inventory_batches').select('expires_on, quantity_remaining').eq('store_id', store.id).gt('quantity_remaining', 0);
      const today = localDate(now, store.timezone);
      const states = (data ?? []).map((b) => batchExpiryState(b.expires_on, today, store.expiry_alert_days ?? 30));
      return `${states.filter((s) => s === 'expired').length} expired and ${states.filter((s) => s === 'expiring').length} expiring batch(es).`;
    }
    case 'purchase_suggestions': {
      const { suggestions } = await purchaseSuggestions(store, { now });
      return suggestions.length ? `${suggestions.length} item(s) to reorder. Open Suggestions to turn them into a purchase.` : 'Nothing needs reordering.';
    }
    case 'khata_overdue_report': {
      const { listAccounts } = await import('../merchantKhata/merchantKhata.service.js');
      const { summary } = await listAccounts(store, { status: 'overdue', now });
      return `${summary.accountCount} khata account(s) overdue, ₹${(summary.overduePaise / 100).toFixed(2)} in total.`;
    }
    default:
      return null;
  }
}

/** Runs every due task once and moves it to its next time. */
export async function runRecurringTasks({ now = new Date() } = {}) {
  const { data, error } = await supabaseAdmin
    .from('recurring_tasks')
    .select(TASK_COLUMNS)
    .eq('is_active', true)
    .lte('next_run_at', now.toISOString());
  fail(error, 'Could not load tasks.');
  let ran = 0;
  for (const task of data ?? []) {
    const { data: store } = await supabaseAdmin.from('stores').select('id, name, timezone, expiry_alert_days').eq('id', task.store_id).maybeSingle();
    if (!store) continue;
    const next = nextRunAfter(task, store.timezone, now).toISOString();
    // Claim this run: only the scheduler that moves next_run_at runs it.
    const { data: claimed } = await supabaseAdmin
      .from('recurring_tasks')
      .update({ next_run_at: next, last_run_at: now.toISOString() })
      .eq('id', task.id)
      .eq('next_run_at', task.next_run_at)
      .select('id')
      .maybeSingle();
    if (!claimed) continue;
    const report = await taskReport(store, task, now);
    await emitToStore(store.id, {
      type: 'recurring_task',
      title: task.title,
      body: report,
      payload: { task_id: task.id, task_type: task.task_type },
      dedupeKey: `recurring_task:${task.id}:${task.next_run_at}`,
    });
    ran += 1;
  }
  return { ran };
}

/** Automatic weekly reminders for overdue khata — the merchant's opt-in. */
export async function setKhataAutoReminders(store, enabled) {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .update({ khata_auto_reminders: enabled })
    .eq('id', store.id)
    .select('khata_auto_reminders')
    .maybeSingle();
  fail(error, 'Could not save the setting.');
  return { khataAutoReminders: data.khata_auto_reminders };
}
