import { supabaseAdmin } from '../../lib/supabase.js';
import { conflict, internal, notFound, unprocessable } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { paymentProvider } from '../payments/provider.js';
import * as notifications from '../notifications/notification.service.js';
import * as events from '../notifications/notification.events.js';
import { emitToStore } from '../notifications/merchantNotification.service.js';

/**
 * Refund settlement — roadmap §4 P2 "Cancellation & Refund Settlement" and §5
 * P5 "Refund Tracking Status". Migration 0038 holds the rules that must never
 * be skipped; this module drives the money:
 *
 *   order cancelled/rejected ──trigger──▶ refund 'initiated' (linked to order + payment)
 *        │
 *        ├─ khata payment ─────────────▶ khata credit entry, 'refunded' at once
 *        └─ gateway payment ──provider.refund()──▶ 'processing'
 *                                   └─ webhook / reconciliation ──▶ 'refunded' | 'failed'
 *
 * Every state change goes through record_refund_update, which refuses illegal
 * moves, ignores replayed and out-of-order provider events, and keeps the
 * payment and order 'paid' until the refund is confirmed. A provider that is
 * unreachable leaves the refund 'initiated' for the reconciliation job — it is
 * never reported as refunded on a guess.
 */

export const REFUND_COLUMNS = `
  id, order_id, payment_id, store_id, customer_id, amount_paise, currency, method,
  provider, provider_refund_ref, status, reason, initiated_by, attempts, last_attempt_at,
  failure_reason, khata_transaction_id, initiated_at, processing_at, refunded_at, failed_at,
  created_at, updated_at, kind, substitution_id
`;

/** Attempts at the provider before an unreachable refund is declared failed. */
export const MAX_PROVIDER_ATTEMPTS = 5;

export const REFUND_STATUS_LABELS = {
  initiated: 'Refund initiated',
  processing: 'Refund processing',
  refunded: 'Refunded',
  failed: 'Refund failed',
};

const METHOD_LABELS = {
  provider: 'To your original payment method',
  khata_credit: 'Credited to your khata at this store',
  cash: 'Cash, at the store',
};

/** What the customer should expect next, in words — not a promise about the bank. */
function nextStepFor(row) {
  if (row.status === 'refunded') {
    return row.method === 'provider'
      ? 'The payment partner has confirmed the refund. Banks usually show it within 5–7 working days.'
      : 'The refund is complete.';
  }
  if (row.status === 'failed') return 'The refund did not go through. The store has been told and will retry or contact you.';
  if (row.method === 'provider') return 'We have asked the payment partner to return your money. We will update this when they confirm.';
  if (row.method === 'cash') return 'Collect the cash refund from the store.';
  return 'The refund is being processed.';
}

export function toPublicRefund(row, eventsList = []) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    paymentId: row.payment_id,
    // cancellation: the order ended; adjustment: part of it was refunded (a substitution cost less).
    kind: row.kind ?? 'cancellation',
    substitutionId: row.substitution_id ?? null,
    status: row.status,
    statusLabel: REFUND_STATUS_LABELS[row.status] ?? row.status,
    amountPaise: row.amount_paise,
    currency: row.currency,
    method: row.method,
    methodLabel: METHOD_LABELS[row.method] ?? row.method,
    reference: row.provider_refund_ref ?? null,
    reason: row.reason ?? null,
    initiatedBy: row.initiated_by,
    failureReason: row.failure_reason ?? null,
    attempts: row.attempts,
    khataTransactionId: row.khata_transaction_id ?? null,
    initiatedAt: row.initiated_at,
    processingAt: row.processing_at ?? null,
    refundedAt: row.refunded_at ?? null,
    failedAt: row.failed_at ?? null,
    nextStep: nextStepFor(row),
    isFinal: row.status === 'refunded',
    events: eventsList.map((event) => ({
      fromStatus: event.from_status ?? null,
      toStatus: event.to_status,
      label: REFUND_STATUS_LABELS[event.to_status] ?? event.to_status,
      source: event.source,
      note: event.note ?? null,
      at: event.created_at,
    })),
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function refundsForOrder(orderId) {
  const { data, error } = await supabaseAdmin
    .from('refunds')
    .select(REFUND_COLUMNS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw internal('Could not load the refund.');
  return data ?? [];
}

export async function refundEvents(refundIds) {
  if (refundIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('refund_events')
    .select('id, refund_id, from_status, to_status, source, note, created_at')
    .in('refund_id', refundIds)
    .order('created_at', { ascending: true });
  if (error) throw internal('Could not load the refund history.');
  return data ?? [];
}

/** The cancellation refund to show for an order: the live one, or the latest if all failed. */
export async function refundViewForOrder(orderId) {
  const rows = (await refundsForOrder(orderId)).filter((row) => (row.kind ?? 'cancellation') === 'cancellation');
  if (rows.length === 0) return null;
  const current = rows.find((row) => row.status !== 'failed') ?? rows[rows.length - 1];
  const history = await refundEvents([current.id]);
  return toPublicRefund(current, history);
}

/** Partial refunds on an order that still stands (e.g. a cheaper substitute). */
export async function adjustmentRefundsForOrder(orderId) {
  const rows = (await refundsForOrder(orderId)).filter((row) => row.kind === 'adjustment');
  if (rows.length === 0) return [];
  const events = await refundEvents(rows.map((row) => row.id));
  return rows.map((row) => toPublicRefund(row, events.filter((event) => event.refund_id === row.id)));
}

async function loadRefund(refundId) {
  const { data, error } = await supabaseAdmin.from('refunds').select(REFUND_COLUMNS).eq('id', refundId).maybeSingle();
  if (error) throw internal('Could not load the refund.');
  return data ?? null;
}

async function loadOrderBrief(orderId) {
  const { data } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, store_id, customer_id')
    .eq('id', orderId)
    .maybeSingle();
  return data ?? null;
}

// ── State changes ───────────────────────────────────────────────────────────

async function announce(refund, status) {
  const order = await loadOrderBrief(refund.order_id);
  if (!order) return;
  const customerEvent = {
    initiated: events.refundInitiated,
    refunded: events.refundCompleted,
    failed: events.refundFailed,
  }[status];
  if (customerEvent) await notifications.emit(refund.customer_id, customerEvent(order, refund));

  if (status === 'failed') {
    await emitToStore(refund.store_id, {
      type: 'refund_failed',
      title: `Refund failed for ${order.order_number}`,
      body: refund.failure_reason ?? 'Retry it from the order, or settle with the customer directly.',
      payload: { order_id: order.id, refund_id: refund.id },
    });
  } else if (status === 'refunded') {
    await emitToStore(refund.store_id, {
      type: 'refund_completed',
      title: `Refund completed for ${order.order_number}`,
      payload: { order_id: order.id, refund_id: refund.id },
    });
  }
}

/**
 * The one way this module changes a refund's state. Returns the RPC's verdict;
 * announces the change to both sides only when it was actually applied, so a
 * replayed webhook never sends a second "refunded" message.
 */
export async function updateRefundState(refundId, toStatus, details = {}) {
  const { data, error } = await supabaseAdmin.rpc('record_refund_update', {
    payload: {
      refund_id: refundId,
      to_status: toStatus,
      source: details.source ?? 'system',
      provider_refund_ref: details.providerRefundRef ?? null,
      failure_reason: details.failureReason ?? null,
      provider_event_id: details.providerEventId ?? null,
      note: details.note ?? null,
      raw: details.raw ?? {},
    },
  });
  if (error) {
    if (/REFUND_ALREADY_LIVE/.test(error.message ?? '')) {
      throw conflict('Another refund for this payment is already in progress.');
    }
    if (/REFUND_NOT_FOUND/.test(error.message ?? '')) throw notFound('Refund');
    logger.error('record_refund_update failed', { refundId, toStatus, code: error.code, message: error.message });
    throw internal('Could not update the refund.');
  }

  if (data?.applied) {
    const refund = await loadRefund(refundId);
    if (refund) await announce(refund, toStatus);
  }
  return data;
}

/**
 * Asks the provider to return the money for one 'initiated' refund. Safe to
 * call again: the provider call is idempotent on the refund id, and only an
 * 'initiated' refund is sent at all.
 */
export async function settleRefund(refundRow) {
  if (refundRow.method !== 'provider' || refundRow.status !== 'initiated') return refundRow;

  const { data: payment, error } = await supabaseAdmin
    .from('payments')
    .select('id, order_id, provider, provider_ref, amount_paise, currency, status')
    .eq('id', refundRow.payment_id)
    .maybeSingle();
  if (error || !payment) {
    logger.error('Refund has no readable payment', { refundId: refundRow.id });
    return refundRow;
  }

  // Count the attempt before making it, so a crash mid-call still counts.
  const attempts = refundRow.attempts + 1;
  await supabaseAdmin
    .from('refunds')
    .update({ attempts, last_attempt_at: new Date().toISOString() })
    .eq('id', refundRow.id)
    .eq('status', 'initiated');

  let result;
  try {
    result = await paymentProvider(refundRow.provider).refund({ payment, refund: refundRow });
  } catch (providerError) {
    logger.warn('Refund request did not reach the provider', {
      refundId: refundRow.id,
      attempts,
      reason: providerError?.message ?? String(providerError),
    });
    if (attempts >= MAX_PROVIDER_ATTEMPTS) {
      await updateRefundState(refundRow.id, 'failed', {
        source: 'system',
        failureReason: `The payment partner could not be reached after ${attempts} attempts.`,
      });
    }
    return (await loadRefund(refundRow.id)) ?? refundRow;
  }

  if (result.status === 'failed') {
    await updateRefundState(refundRow.id, 'failed', {
      source: 'provider',
      providerRefundRef: result.providerRefundRef,
      failureReason: result.failureReason,
      raw: result.raw,
    });
  } else if (result.status === 'processing' || result.status === 'refunded') {
    await updateRefundState(refundRow.id, result.status, {
      source: 'provider',
      providerRefundRef: result.providerRefundRef,
      raw: result.raw,
    });
  }
  return (await loadRefund(refundRow.id)) ?? refundRow;
}

/**
 * Called once an order has ended cancelled or rejected. The trigger has
 * already opened whatever refund is due; this tells the customer and sends
 * gateway refunds to the provider. Never throws: the order has moved, and a
 * refund that could not be sent now is picked up by reconciliation.
 */
export async function afterOrderEnded(orderId) {
  try {
    const rows = await refundsForOrder(orderId);
    for (const row of rows) {
      if (row.status === 'initiated') {
        await announce(row, 'initiated');
        await settleRefund(row);
      } else if (row.status === 'refunded' && row.method === 'khata_credit') {
        await announce(row, 'refunded');
      }
    }
  } catch (error) {
    logger.error('Could not settle the refund after the order ended', { orderId, reason: error?.message ?? String(error) });
  }
}

/** A payment confirmed after its order was already cancelled — the money goes back. */
export async function refundLateCapture(orderId) {
  const { data, error } = await supabaseAdmin.rpc('initiate_order_refund', {
    p_order_id: orderId,
    p_initiated_by: 'payment_webhook',
    p_reason: 'The payment arrived after the order had been cancelled.',
  });
  if (error) {
    logger.error('Could not open a refund for a late payment', { orderId, message: error.message });
    return null;
  }
  if (data) await afterOrderEnded(orderId);
  return data;
}

/** A provider's refund webhook (already signature-verified by the provider module). */
export async function handleRefundEvent(providerName, event) {
  const { data: refund, error } = await supabaseAdmin
    .from('refunds')
    .select(REFUND_COLUMNS)
    .eq('provider', providerName)
    .eq('provider_refund_ref', event.providerRefundRef)
    .maybeSingle();
  if (error) throw internal('Could not load the refund.');
  if (!refund) {
    logger.warn('Refund webhook for an unknown reference', { providerRefundRef: event.providerRefundRef });
    return { applied: false, reason: 'UNKNOWN_REFUND' };
  }

  const result = await updateRefundState(refund.id, event.status, {
    source: 'webhook',
    providerEventId: event.eventId,
    failureReason: event.failureReason,
    raw: event.raw,
  });
  return { applied: Boolean(result?.applied), reason: result?.reason ?? null, status: result?.status ?? refund.status };
}

/**
 * The reconciliation job. Sends refunds that never reached the provider, and
 * asks the provider about refunds still processing. Idempotent and safe to run
 * from several schedulers at once: every write goes through the guarded RPC.
 */
export async function reconcileRefunds({ now = new Date(), retryAfterSeconds = 60 } = {}) {
  const summary = { sent: 0, settled: 0, failed: 0, stillProcessing: 0 };

  const { data: open, error } = await supabaseAdmin
    .from('refunds')
    .select(REFUND_COLUMNS)
    .eq('method', 'provider')
    .in('status', ['initiated', 'processing'])
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw internal('Could not load open refunds.');

  for (const row of open ?? []) {
    if (row.status === 'initiated') {
      const last = row.last_attempt_at ? new Date(row.last_attempt_at).getTime() : 0;
      if (now.getTime() - last < retryAfterSeconds * 1000) continue;
      const after = await settleRefund(row);
      summary.sent += 1;
      if (after.status === 'failed') summary.failed += 1;
      continue;
    }

    const provider = paymentProvider(row.provider);
    if (typeof provider.fetchRefund !== 'function') continue;
    let answer;
    try {
      answer = await provider.fetchRefund({ providerRefundRef: row.provider_refund_ref, now: now.getTime() });
    } catch (fetchError) {
      logger.warn('Refund status lookup failed', { refundId: row.id, reason: fetchError?.message });
      continue;
    }
    if (answer.status === 'refunded' || answer.status === 'failed') {
      await updateRefundState(row.id, answer.status, {
        source: 'reconciliation',
        failureReason: answer.failureReason ?? null,
        raw: answer.raw,
      });
      if (answer.status === 'refunded') summary.settled += 1;
      else summary.failed += 1;
    } else {
      summary.stillProcessing += 1;
    }
  }
  return summary;
}

// ── Merchant actions ────────────────────────────────────────────────────────

async function findStoreRefund(store, refundId) {
  const { data, error } = await supabaseAdmin
    .from('refunds')
    .select(REFUND_COLUMNS)
    .eq('id', refundId)
    .eq('store_id', store.id)
    .maybeSingle();
  if (error) throw internal('Could not load the refund.');
  if (!data) throw notFound('Refund');
  return data;
}

export async function listStoreRefunds(store, { status, page = 1, limit = 20 }) {
  let query = supabaseAdmin.from('refunds').select(REFUND_COLUMNS, { count: 'exact' }).eq('store_id', store.id);
  if (status) query = query.in('status', status);
  const from = (page - 1) * limit;
  const { data, count, error } = await query.order('created_at', { ascending: false }).range(from, from + limit - 1);
  if (error) throw internal('Could not load refunds.');

  const rows = data ?? [];
  const orderIds = [...new Set(rows.map((row) => row.order_id))];
  const numbers = new Map();
  if (orderIds.length) {
    const { data: orders } = await supabaseAdmin.from('orders').select('id, order_number').in('id', orderIds);
    for (const order of orders ?? []) numbers.set(order.id, order.order_number);
  }
  return {
    refunds: rows.map((row) => ({ ...toPublicRefund(row), orderNumber: numbers.get(row.order_id) ?? null })),
    total: count ?? rows.length,
  };
}

export async function getStoreRefund(store, refundId) {
  const row = await findStoreRefund(store, refundId);
  return toPublicRefund(row, await refundEvents([row.id]));
}

/** A failed gateway refund, sent again. */
export async function retryRefund(store, refundId) {
  const row = await findStoreRefund(store, refundId);
  if (row.status !== 'failed') {
    throw conflict('Only a failed refund can be retried.', { status: row.status });
  }
  if (row.method !== 'provider') {
    throw unprocessable('NOT_A_GATEWAY_REFUND', 'Only a refund to the original payment method can be retried.');
  }
  await updateRefundState(row.id, 'initiated', { source: 'merchant', note: 'Retried by the store' });
  await settleRefund(await loadRefund(row.id));
  return getStoreRefund(store, refundId);
}

/** The merchant handed the cash back — their record is the confirmation for a cash refund. */
export async function confirmCashRefund(store, refundId, { note }) {
  const row = await findStoreRefund(store, refundId);
  if (row.method !== 'cash') {
    throw unprocessable('NOT_A_CASH_REFUND', 'Only a cash refund is confirmed by the store.');
  }
  if (row.status === 'refunded') return getStoreRefund(store, refundId);
  await updateRefundState(row.id, 'refunded', { source: 'merchant', note: note ?? 'Cash returned at the store' });
  return getStoreRefund(store, refundId);
}
