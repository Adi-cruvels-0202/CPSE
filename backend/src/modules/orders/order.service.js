import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, notFound, conflict, unprocessable } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { buildQuote, assertQuotePlaceable, addressSnapshot, storeSnapshot } from '../checkout/checkout.service.js';
import { toPublicAddress } from '../addresses/address.service.js';
import { addItem, getCart } from '../cart/cart.service.js';
import { findActiveStoreById } from '../stores/store.service.js';
import {
  STATUS_LABELS,
  canCustomerCancel,
  canTransition,
  isTerminal,
  timelineFor,
} from './order.state.js';

/**
 * Orders — checklist 7.4 – 7.9 and 8.1 – 8.9.
 *
 * Creation is one call to the `create_order` Postgres function (migration
 * 0020): order, items, first history entry, payment intent, stock decrement
 * and cart checkout all commit together or not at all. This module's job is
 * everything around that — pricing through the shared quote, idempotency,
 * mapping the function's errors to customer-facing ones, and every read.
 *
 * Ownership (8.9): `customer_id` comes from the verified JWT and is part of
 * every filter, so another customer's order is a 404.
 */

const fail = (error, message) => {
  if (error) throw internal(message);
};

const ORDER_COLUMNS = `
  id, order_number, store_id, customer_id, fulfilment_mode, status, payment_status,
  address_id, delivery_address, store_snapshot,
  subtotal_paise, discount_paise, delivery_fee_paise, tax_paise, total_paise,
  customer_note, cancellation_reason, idempotency_key,
  placed_at, completed_at, cancelled_at, created_at, updated_at
`;

const ORDER_ITEM_COLUMNS = `
  id, order_id, product_id, variant_id, product_name, variant_name, image_url,
  unit_price_paise, quantity, line_total_paise, created_at
`;

// ── Creation ────────────────────────────────────────────────────────────────

/**
 * Checklist 7.4 – 7.9. The quote (6.7) is the only source of prices, so the
 * total written here is the one the customer was shown.
 */
export async function createOrder(customerId, input, { idempotencyKey = null } = {}) {
  // Checklist 7.5. Checked BEFORE anything is priced, because the first
  // attempt already emptied the cart: a client retrying after a network
  // timeout would otherwise be told its cart is empty instead of being handed
  // back the order it successfully placed. The same check inside create_order
  // remains, to close the window where two retries arrive together.
  if (idempotencyKey) {
    const existing = await findOrderByIdempotencyKey(customerId, idempotencyKey);
    if (existing) return { order: await getOrder(customerId, existing.id), replayed: true };
  }

  const quote = await buildQuote(customerId, input);

  // Checklist 7.4: the same blockers that grey out the checkout button refuse
  // the write, for a client that skipped quoting.
  assertQuotePlaceable(quote);

  const { store, address, lines, totals } = quote._internal;

  // The customer agreed to a number; if the basket repriced since, they are
  // asked again rather than charged the new one.
  if (input.expectedTotalPaise !== undefined && input.expectedTotalPaise !== totals.totalPaise) {
    throw unprocessable(
      'TOTAL_CHANGED',
      'The total has changed since you last saw it. Please review your order.',
      { expectedTotalPaise: input.expectedTotalPaise, totalPaise: totals.totalPaise },
    );
  }

  const isOnline = input.paymentMethod === 'online';

  const payload = {
    customer_id: customerId,
    store_id: store.id,
    cart_id: quote.cartId,
    fulfilment_mode: input.fulfilmentMode,
    // Checklist 7.13: an online order is NOT placed until the provider
    // confirms it; a cash order is placed the moment it is submitted.
    status: isOnline ? 'pending_payment' : 'placed',
    payment_status: 'pending',
    address_id: address?.id ?? null,
    // Checklist 7.7: snapshots, so history survives a merchant edit or a
    // deleted address (D11).
    delivery_address: address ? addressSnapshot(address) : null,
    store_snapshot: storeSnapshot(store),
    subtotal_paise: totals.subtotalPaise,
    discount_paise: totals.discountPaise,
    delivery_fee_paise: totals.deliveryFeePaise,
    tax_paise: totals.taxPaise,
    total_paise: totals.totalPaise,
    customer_note: input.customerNote ?? null,
    idempotency_key: idempotencyKey,
    history_note: isOnline ? 'Awaiting online payment' : 'Order placed',
    items: lines.map((line) => ({
      product_id: line.productId,
      variant_id: line.variantId,
      product_name: line.name,
      variant_name: line.variantName,
      image_url: line.imageUrl,
      unit_price_paise: line.unitPricePaise,
      quantity: line.quantity,
      line_total_paise: line.lineTotalPaise,
    })),
    payment: isOnline
      ? { provider: 'mock', amount_paise: totals.totalPaise, currency: 'INR', status: 'pending' }
      : null,
  };

  const { data, error } = await supabaseAdmin.rpc('create_order', { payload });

  if (error) throw translateCreateError(error);

  // Checklist 7.5. A replay returns the original order untouched — same id,
  // same number, no second charge and no second stock decrement.
  const result = Array.isArray(data) ? data[0] : data;
  const order = await getOrder(customerId, result.order_id);

  return { order, replayed: Boolean(result.replayed) };
}

/**
 * The Postgres function raises for the one thing the quote cannot rule out:
 * an item that sold out between the quote and the commit. Everything else is
 * a genuine failure and must not be dressed up as a customer error.
 */
function translateCreateError(error) {
  const message = error.message ?? '';

  if (message.includes('ITEM_UNAVAILABLE:')) {
    const name = message.split('ITEM_UNAVAILABLE:')[1]?.split('\n')[0]?.trim() || 'An item';
    return unprocessable(
      'ITEM_UNAVAILABLE',
      `${name} sold out while you were checking out. Please review your cart.`,
    );
  }

  // A duplicate Idempotency-Key that raced past the function's own check.
  if (error.code === '23505' && message.includes('idempotency')) {
    return conflict('This order has already been submitted.');
  }

  logger.error('create_order failed', { code: error.code, message });
  return internal('Could not place your order.');
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Checklist 7.5. The unique index this reads is (customer_id, idempotency_key). */
export async function findOrderByIdempotencyKey(customerId, idempotencyKey) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, status')
    .eq('customer_id', customerId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  fail(error, 'Could not check for a duplicate order.');
  return data ?? null;
}

/** Checklist 8.9. The ownership filter, in one place. */
export async function findOwnedOrder(customerId, orderId) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(ORDER_COLUMNS)
    .eq('id', orderId)
    .eq('customer_id', customerId)
    .maybeSingle();

  fail(error, 'Could not load the order.');
  if (!data) throw notFound('Order');
  return data;
}

async function listOrderItems(orderId) {
  const { data, error } = await supabaseAdmin
    .from('order_items')
    .select(ORDER_ITEM_COLUMNS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  fail(error, 'Could not load the order items.');
  return data ?? [];
}

async function listStatusHistory(orderId) {
  const { data, error } = await supabaseAdmin
    .from('order_status_history')
    .select('id, order_id, from_status, to_status, note, changed_by, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  fail(error, 'Could not load the order history.');
  return data ?? [];
}

async function latestPayment(orderId) {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('id, order_id, provider, provider_ref, amount_paise, currency, status, failure_reason, paid_at, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1);

  fail(error, 'Could not load the payment.');
  return (data ?? [])[0] ?? null;
}

export const toPublicOrderItem = (row) => ({
  id: row.id,
  productId: row.product_id ?? null,
  variantId: row.variant_id ?? null,
  // The snapshot, not a live lookup — this is what the customer actually bought.
  name: row.product_name,
  variantName: row.variant_name ?? null,
  imageUrl: row.image_url ?? null,
  unitPricePaise: row.unit_price_paise,
  quantity: row.quantity,
  lineTotalPaise: row.line_total_paise,
});

/** Never exposes the raw gateway payload or anything resembling a credential. */
export const toPublicPayment = (row) =>
  row
    ? {
        id: row.id,
        provider: row.provider,
        providerRef: row.provider_ref ?? null,
        amountPaise: row.amount_paise,
        currency: row.currency,
        status: row.status,
        failureReason: row.failure_reason ?? null,
        paidAt: row.paid_at ?? null,
      }
    : null;

/** The list-row shape: enough for an order-history card, nothing more. */
export function toOrderSummary(row, itemCount = null) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    storeId: row.store_id,
    storeName: row.store_snapshot?.name ?? null,
    fulfilmentMode: row.fulfilment_mode,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    paymentStatus: row.payment_status,
    totalPaise: row.total_paise,
    itemCount,
    placedAt: row.placed_at,
    completedAt: row.completed_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    isCancellable: canCustomerCancel(row.status),
  };
}

/** Checklist 8.2 + 8.5 */
export function toOrderDetail(row, { items, history, payment }) {
  return {
    ...toOrderSummary(row, items.length),
    items: items.map(toPublicOrderItem),
    totals: {
      subtotalPaise: row.subtotal_paise,
      discountPaise: row.discount_paise,
      deliveryFeePaise: row.delivery_fee_paise,
      taxPaise: row.tax_paise,
      totalPaise: row.total_paise,
    },
    // Checklist 8.5: a pickup order shows where to collect from; a delivery
    // order shows where it is going and what the delivery cost.
    fulfilment:
      row.fulfilment_mode === 'delivery'
        ? {
            mode: 'delivery',
            address: row.delivery_address ?? null,
            deliveryFeePaise: row.delivery_fee_paise,
          }
        : { mode: 'pickup', pickupFrom: row.store_snapshot ?? null },
    store: row.store_snapshot ?? null,
    payment: toPublicPayment(payment),
    customerNote: row.customer_note ?? null,
    cancellationReason: row.cancellation_reason ?? null,
    timeline: buildTimeline(row, history),
    isCancellable: canCustomerCancel(row.status),
  };
}

/**
 * Checklist 8.2. The steps this order will pass through, each marked with when
 * it happened — so the client renders one progress strip instead of stitching
 * the happy path together from a list of past events.
 */
export function buildTimeline(row, history) {
  const reachedAt = new Map(history.map((entry) => [entry.to_status, entry.created_at]));

  const steps = timelineFor(row.fulfilment_mode).map((status) => ({
    status,
    label: STATUS_LABELS[status],
    reachedAt: reachedAt.get(status) ?? null,
    isCurrent: row.status === status,
  }));

  // A cancelled, rejected or payment-pending order is not on the happy path,
  // so its state is appended rather than pretended away.
  if (!steps.some((step) => step.isCurrent)) {
    steps.push({
      status: row.status,
      label: STATUS_LABELS[row.status],
      reachedAt: reachedAt.get(row.status) ?? row.updated_at,
      isCurrent: true,
    });
  }

  return {
    steps,
    history: history.map((entry) => ({
      fromStatus: entry.from_status ?? null,
      toStatus: entry.to_status,
      label: STATUS_LABELS[entry.to_status] ?? entry.to_status,
      note: entry.note ?? null,
      changedBy: entry.changed_by,
      at: entry.created_at,
    })),
  };
}

/** Checklist 8.1 */
export async function listOrders(customerId, { status, storeId, page, limit }) {
  let query = supabaseAdmin
    .from('orders')
    .select(ORDER_COLUMNS, { count: 'exact' })
    .eq('customer_id', customerId);

  if (status) query = query.eq('status', status);
  if (storeId) query = query.eq('store_id', storeId);

  const from = (page - 1) * limit;
  const { data, count, error } = await query
    .order('placed_at', { ascending: false })
    .range(from, from + limit - 1);

  fail(error, 'Could not load your orders.');

  const rows = data ?? [];
  const counts = await itemCounts(rows.map((row) => row.id));

  return {
    orders: rows.map((row) => toOrderSummary(row, counts.get(row.id) ?? 0)),
    total: count ?? rows.length,
  };
}

async function itemCounts(orderIds) {
  if (orderIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('order_items')
    .select('order_id')
    .in('order_id', orderIds);

  fail(error, 'Could not load the order items.');

  const counts = new Map();
  for (const row of data ?? []) counts.set(row.order_id, (counts.get(row.order_id) ?? 0) + 1);
  return counts;
}

/** Checklist 8.2 */
export async function getOrder(customerId, orderId) {
  const row = await findOwnedOrder(customerId, orderId);

  const [items, history, payment] = await Promise.all([
    listOrderItems(row.id),
    listStatusHistory(row.id),
    latestPayment(row.id),
  ]);

  return toOrderDetail(row, { items, history, payment });
}

// ── Transitions ─────────────────────────────────────────────────────────────

/**
 * Checklist 8.3. The single writer of `orders.status`. Every caller — the
 * customer cancelling, a payment confirmation, the test-only merchant
 * endpoint — goes through here, so an illegal transition is impossible to make
 * by accident and the audit trail can never be skipped.
 */
export async function transitionOrder(orderRow, toStatus, { changedBy, note = null, patch = {} }) {
  if (!canTransition(orderRow.status, toStatus)) {
    throw conflict(
      `An order that is ${STATUS_LABELS[orderRow.status]?.toLowerCase() ?? orderRow.status} cannot become ${
        STATUS_LABELS[toStatus]?.toLowerCase() ?? toStatus
      }.`,
      { from: orderRow.status, to: toStatus },
    );
  }

  const timestamps = {};
  if (toStatus === 'completed') timestamps.completed_at = new Date().toISOString();
  if (toStatus === 'cancelled' || toStatus === 'rejected') {
    timestamps.cancelled_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from('orders')
    .update({ status: toStatus, ...timestamps, ...patch })
    .eq('id', orderRow.id)
    // Guards against two writers racing: the row must still be in the state we
    // validated against.
    .eq('status', orderRow.status)
    .select(ORDER_COLUMNS)
    .maybeSingle();

  fail(error, 'Could not update the order.');
  if (!data) throw conflict('The order changed while you were updating it. Please try again.');

  const { error: historyError } = await supabaseAdmin.from('order_status_history').insert({
    order_id: orderRow.id,
    from_status: orderRow.status,
    to_status: toStatus,
    changed_by: changedBy,
    note,
  });

  fail(historyError, 'Could not record the order history.');
  return data;
}

/**
 * Checklist 8.4. Only from a state the customer is allowed to leave; anything
 * later is the merchant's decision, because the goods may already be packed.
 */
export async function cancelOrder(customerId, orderId, reason) {
  const row = await findOwnedOrder(customerId, orderId);

  if (isTerminal(row.status)) {
    throw conflict(`This order is already ${STATUS_LABELS[row.status].toLowerCase()}.`);
  }
  if (!canCustomerCancel(row.status)) {
    throw conflict(
      'This order is already being prepared. Please call the store to cancel it.',
      { status: row.status },
    );
  }

  await transitionOrder(row, 'cancelled', {
    changedBy: 'customer',
    note: reason ?? null,
    patch: { cancellation_reason: reason ?? null },
  });

  return getOrder(customerId, orderId);
}

/** Checklist 8.6. The receipt is derived from the order, never recalculated. */
export async function getReceipt(customerId, orderId) {
  const order = await getOrder(customerId, orderId);

  return {
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    status: order.status,
    store: order.store,
    customerNote: order.customerNote,
    fulfilment: order.fulfilment,
    billedTo:
      order.fulfilment.mode === 'delivery' ? order.fulfilment.address : (order.store ?? null),
    lines: order.items,
    totals: order.totals,
    payment: order.payment
      ? {
          method: 'online',
          status: order.payment.status,
          reference: order.payment.providerRef,
          paidAt: order.payment.paidAt,
        }
      : { method: 'cash', status: order.paymentStatus, reference: null, paidAt: null },
    // Not a tax invoice: prices are tax-inclusive and no GSTIN is collected (D27).
    isTaxInvoice: false,
  };
}

/**
 * Checklist 8.7. Rebuilds the cart from a past order and reports what could
 * not be added, rather than refusing the whole reorder because one product is
 * gone. Items are added one at a time through the normal cart path, so every
 * stock and availability rule applies exactly as it would to a fresh add.
 */
const removedItem = (name) => ({
  name,
  code: 'PRODUCT_REMOVED',
  message: `${name} is no longer sold by this store.`,
});

export async function reorder(customerId, orderId) {
  const row = await findOwnedOrder(customerId, orderId);
  // A store that has closed down cannot be reordered from at all.
  await findActiveStoreById(row.store_id);

  const items = await listOrderItems(row.id);
  const unavailable = [];

  for (const item of items) {
    if (!item.product_id) {
      unavailable.push({ ...removedItem(item.product_name) });
      continue;
    }

    try {
      await addItem(customerId, {
        storeId: row.store_id,
        productId: item.product_id,
        variantId: item.variant_id ?? null,
        quantity: item.quantity,
      });
    } catch (error) {
      // An expected refusal — sold out, withdrawn, a variant retired — is part
      // of the reorder's report. Anything else is a real failure.
      if (!error.isOperational || error.statusCode >= 500) throw error;
      // A deleted product reaches here as a bare 404. Reported as a removed
      // item, because "Resource was not found" means nothing to a customer
      // looking at their own past order.
      unavailable.push(
        error.code === 'NOT_FOUND'
          ? removedItem(item.product_name)
          : { name: item.product_name, code: error.code, message: error.message },
      );
    }
  }

  return {
    storeId: row.store_id,
    cart: await getCart(customerId, row.store_id),
    unavailableItems: unavailable,
    // True only when the whole order made it back into the cart.
    isComplete: unavailable.length === 0,
  };
}
