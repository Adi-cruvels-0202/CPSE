import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { deliver } from '../lib/channels.js';
import { reconcileRefunds } from '../modules/refunds/refund.service.js';
import { expireOffers } from '../modules/offers/offer.service.js';
import * as automation from '../modules/automation/automation.service.js';
import { escalateUnanswered } from '../modules/messaging/messaging.service.js';
import { recordAbandonedCarts } from '../modules/engagement/cartEvents.js';

/**
 * Scheduled operations — roadmap Phase C, §7 (jobs idempotent, safe to retry).
 *
 * Each job takes a short lease before it runs (acquire_job_lease, migration
 * 0043), so several app instances can all run the scheduler and each job still
 * runs one at a time; every run is logged in job_runs with its summary or its
 * error. Every job is itself idempotent, so a crash halfway is fixed by the
 * next run, never doubled.
 */

const MAX_DELIVERY_ATTEMPTS = 5;

/** SMS / WhatsApp / email attempts, with backoff, recording every outcome. */
export async function runDeliveries({ now = new Date(), fetchImpl } = {}) {
  const { data, error } = await supabaseAdmin
    .from('notification_deliveries')
    .select('id, notification_id, channel, status, attempts')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', now.toISOString())
    .limit(200);
  if (error) throw new Error(error.message);
  const summary = { sent: 0, skipped: 0, failed: 0 };
  for (const delivery of data ?? []) {
    if (delivery.channel === 'in_app' || delivery.attempts >= MAX_DELIVERY_ATTEMPTS) continue;
    const { data: notification } = await supabaseAdmin
      .from('notifications')
      .select('customer_id, title, body')
      .eq('id', delivery.notification_id)
      .maybeSingle();
    if (!notification) continue;
    const { data: customer } = await supabaseAdmin.from('customers').select('phone, email').eq('id', notification.customer_id).maybeSingle();
    const to = delivery.channel === 'email' ? customer?.email : customer?.phone;
    const outcome = to
      ? await deliver(delivery.channel, { to, title: notification.title, body: notification.body }, fetchImpl ? { fetchImpl } : {})
      : { status: 'skipped', error: `No ${delivery.channel === 'email' ? 'email address' : 'phone number'} on the account.` };
    const attempts = delivery.attempts + 1;
    const retry = outcome.status === 'failed' && attempts < MAX_DELIVERY_ATTEMPTS;
    await supabaseAdmin
      .from('notification_deliveries')
      .update({
        status: outcome.status,
        attempts,
        last_error: outcome.error ?? null,
        provider_ref: outcome.providerRef ?? null,
        delivered_at: outcome.status === 'sent' ? now.toISOString() : null,
        // Exponential backoff: 2, 4, 8, 16 minutes.
        next_attempt_at: retry ? new Date(now.getTime() + 2 ** attempts * 60_000).toISOString() : null,
      })
      .eq('id', delivery.id)
      .eq('attempts', delivery.attempts);
    summary[outcome.status === 'sent' ? 'sent' : outcome.status === 'skipped' ? 'skipped' : 'failed'] += 1;
  }
  return summary;
}

async function expirePendingOrders() {
  const { data, error } = await supabaseAdmin.rpc('expire_stale_pending_orders', { p_older_than: '2 hours' });
  if (error) throw new Error(error.message);
  return { expired: (data ?? []).length };
}

export const JOBS = [
  { name: 'expire-pending-orders', everySeconds: 300, run: expirePendingOrders },
  { name: 'reconcile-refunds', everySeconds: 120, run: (ctx) => reconcileRefunds(ctx) },
  { name: 'expire-offers', everySeconds: 300, run: async (ctx) => ({ ended: await expireOffers(ctx) }) },
  { name: 'low-stock-alerts', everySeconds: 900, run: automation.runLowStockAlerts },
  { name: 'expiry-alerts', everySeconds: 3600, run: automation.runExpiryAlerts },
  { name: 'recurring-tasks', everySeconds: 60, run: automation.runRecurringTasks },
  { name: 'reorder-reminders', everySeconds: 3600, run: automation.runReorderReminders },
  { name: 'khata-reminders', everySeconds: 3600, run: automation.runKhataReminders },
  { name: 'points-expiry', everySeconds: 86_400, run: automation.runPointsExpiry },
  { name: 'support-escalation', everySeconds: 900, run: escalateUnanswered },
  { name: 'abandoned-carts', everySeconds: 3600, run: recordAbandonedCarts },
  { name: 'notification-deliveries', everySeconds: 60, run: runDeliveries },
];

const holder = `${process.pid}-${randomUUID().slice(0, 8)}`;

/** Runs one job under its lease, logging the run. Returns its summary, or null if another instance holds it. */
export async function runJob(job, { now = new Date(), force = false } = {}) {
  if (!force) {
    const { data: acquired, error } = await supabaseAdmin.rpc('acquire_job_lease', {
      p_job: job.name,
      p_holder: holder,
      p_seconds: Math.max(30, Math.min(job.everySeconds, 600)),
    });
    if (error) throw new Error(error.message);
    if (!acquired) return null;
  }
  const { data: run } = await supabaseAdmin.from('job_runs').insert({ job: job.name }).select('id').maybeSingle();
  try {
    const summary = await job.run({ now });
    if (run) await supabaseAdmin.from('job_runs').update({ status: 'succeeded', finished_at: new Date().toISOString(), summary }).eq('id', run.id);
    return summary;
  } catch (error) {
    logger.error('job failed', { job: job.name, reason: error?.message });
    if (run) {
      await supabaseAdmin
        .from('job_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), error: String(error?.message ?? error).slice(0, 1000) })
        .eq('id', run.id);
    }
    return { error: String(error?.message ?? error) };
  }
}

/** Every job once, in order — `npm run db:maintenance` and tests. */
export async function runAllJobs({ now = new Date(), force = true } = {}) {
  const results = {};
  for (const job of JOBS) results[job.name] = await runJob(job, { now, force });
  return results;
}

let timers = [];

/** In-process scheduler. Started by server.js when JOBS_ENABLED. */
export function startScheduler() {
  if (!env.JOBS_ENABLED || env.isTest) return;
  for (const job of JOBS) {
    const interval = Math.max(job.everySeconds, env.JOBS_INTERVAL_SECONDS) * 1000;
    const tick = () => runJob(job).catch((error) => logger.error('scheduler tick failed', { job: job.name, reason: error?.message }));
    timers.push(setTimeout(tick, 5_000 + Math.random() * 10_000).unref());
    timers.push(setInterval(tick, interval).unref());
  }
  logger.info('scheduler started', { jobs: JOBS.map((j) => j.name) });
}

export function stopScheduler() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
}
