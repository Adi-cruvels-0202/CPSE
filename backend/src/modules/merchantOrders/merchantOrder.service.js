import { supabaseAdmin } from '../../lib/supabase.js';
import { conflict, internal, notFound } from '../../lib/errors.js';
import { STATUS_LABELS, ORDER_STATUSES } from '../orders/order.state.js';
import { transitionOrder } from '../orders/order.service.js';

/**
 * A merchant's orders — MERCHANT_API.md, Orders; MERCHANT_RULES §6.
 * `store` is the caller's own store (requireStoreOwner).
 *
 * The states are the customer side's (D-7), and every action goes through
 * transitionOrder — the single writer of orders.status — so the customer is
 * notified of each one and the stock trigger (migration 0030) releases or
 * deducts with it. Nothing here touches stock or sends a notification itself.
 */

const ORDER_COLUMNS = `
  id, order_number, store_id, customer_id, fulfilment_mode, status, payment_status,
  delivery_address, subtotal_paise, discount_paise, delivery_fee_paise, tax_paise,
  total_paise, customer_note, cancellation_reason, placed_at, accepted_at, rejected_at,
  completed_at, cancelled_at, created_at, updated_at
`;

// ── What the merchant may do ─────────────────────────────────────────────────

/**
 * The buttons the merchant app shows, decided here so the screen never
 * re-implements the rules. Every action below checks against this same list.
 *
 *   placed            accept, reject
 *   accepted          status:preparing, reject, cancel
 *   preparing         status:ready_for_pickup | status:out_for_delivery, cancel
 *   ready / out       complete, cancel
 *
 * pending_payment has none: only a confirmed payment moves it. A placed order
 * is rejected, not cancelled — nothing has been agreed yet (MERCHANT_RULES O-1).
 */
export function allowedActions(order) {
  switch (order.status) {
    case 'placed':
      return ['accept', 'reject'];
    case 'accepted':
      return ['status:preparing', 'reject', 'cancel'];
    case 'preparing':
      return [
        order.fulfilment_mode === 'delivery' ? 'status:out_for_delivery' : 'status:ready_for_pickup',
        'cancel',
      ];
    case 'ready_for_pickup':
    case 'out_for_delivery':
      return ['complete', 'cancel'];
    default:
      return [];
  }
}

function assertAllowed(order, action) {
  if (allowedActions(order).includes(action)) return;

  const label = STATUS_LABELS[order.status]?.toLowerCase() ?? order.status;
  const why =
    order.status === 'pending_payment'
      ? 'It is waiting for the customer to pay.'
      : action === 'cancel' && order.status === 'placed'
        ? 'Reject it instead — it has not been accepted yet.'
        : `It is ${label}.`;
  throw conflict(`This order cannot be changed that way. ${why}`, { status: order.status, action });
}

// ── Shapes ───────────────────────────────────────────────────────────────────

const toItem = (row) => ({
  id: row.id,
  productId: row.product_id ?? null,
  variantId: row.variant_id ?? null,
  productName: row.product_name,
  variantName: row.variant_name ?? null,
  sku: row.sku ?? null,
  quantity: row.quantity,
  unitPricePaise: row.unit_price_paise,
  lineSubtotalPaise: row.unit_price_paise * row.quantity,
  taxPercent: Number(row.tax_percent ?? 0),
  taxPaise: row.tax_paise ?? 0,
  lineTotalPaise: row.line_total_paise,
});

function toSummary(row, { customer, isOnline, itemCount }) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    paymentStatus: row.payment_status,
    // A payment row exists only for online orders (create_order).
    paymentMethod: isOnline ? 'online' : 'cash',
    fulfilmentMode: row.fulfilment_mode,
    allowedActions: allowedActions(row),
    customer: {
      id: row.customer_id,
      name: customer?.full_name ?? row.delivery_address?.recipientName ?? null,
      phone: row.delivery_address?.phone ?? customer?.phone ?? null,
    },
    customerNote: row.customer_note ?? null,
    cancellationReason: row.cancellation_reason ?? null,
    totals: {
      subtotalPaise: row.subtotal_paise,
      discountPaise: row.discount_paise,
      deliveryFeePaise: row.delivery_fee_paise,
      taxPaise: row.tax_paise,
      totalPaise: row.total_paise,
    },
    itemCount,
    placedAt: row.placed_at,
    acceptedAt: row.accepted_at ?? null,
    completedAt: row.completed_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    updatedAt: row.updated_at,
  };
}

/** Customers, payment methods and item counts for a set of orders, in three lookups. */
async function related(rows) {
  const orderIds = rows.map((row) => row.id);
  const customerIds = [...new Set(rows.map((row) => row.customer_id))];
  if (orderIds.length === 0) return { customers: new Map(), online: new Set(), counts: new Map() };

  const [customers, payments, items] = await Promise.all([
    supabaseAdmin.from('customers').select('id, full_name, phone').in('id', customerIds),
    supabaseAdmin.from('payments').select('order_id').in('order_id', orderIds),
    supabaseAdmin.from('order_items').select('order_id').in('order_id', orderIds),
  ]);
  if (customers.error || payments.error || items.error) throw internal('Could not load the orders.');

  const counts = new Map();
  for (const { order_id: id } of items.data ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);

  return {
    customers: new Map((customers.data ?? []).map((row) => [row.id, row])),
    online: new Set((payments.data ?? []).map((row) => row.order_id)),
    counts,
  };
}

const summaryOf = (row, { customers, online, counts }) =>
  toSummary(row, { customer: customers.get(row.customer_id), isOnline: online.has(row.id), itemCount: counts.get(row.id) ?? 0 });

// ── Reads ────────────────────────────────────────────────────────────────────

/** One of this store's orders, or 404 — another store's is no different from none. */
async function findStoreOrder(store, orderId) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(ORDER_COLUMNS)
    .eq('id', orderId)
    .eq('store_id', store.id)
    .maybeSingle();

  if (error) throw internal('Could not load the order.');
  if (!data) throw notFound('Order');
  return data;
}

/** `GET …/orders/:orderId` — the whole order, with its lines and history. */
export async function getOrder(store, orderId) {
  const row = await findStoreOrder(store, orderId);

  const [items, history, extra] = await Promise.all([
    supabaseAdmin
      .from('order_items')
      .select('id, product_id, variant_id, product_name, variant_name, sku, quantity, unit_price_paise, tax_percent, tax_paise, line_total_paise, created_at')
      .eq('order_id', row.id)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('order_status_history')
      .select('to_status, changed_by, note, created_at')
      .eq('order_id', row.id)
      .order('created_at', { ascending: true }),
    related([row]),
  ]);
  if (items.error || history.error) throw internal('Could not load the order.');

  return {
    ...summaryOf(row, extra),
    deliveryAddress: row.delivery_address ?? null,
    items: (items.data ?? []).map(toItem),
    history: (history.data ?? []).map((entry) => ({
      status: entry.to_status,
      changedBy: entry.changed_by,
      note: entry.note ?? null,
      at: entry.created_at,
    })),
  };
}

/**
 * `GET …/orders` — newest first. An order still waiting for online payment is
 * left out unless asked for by name: the merchant can do nothing with it yet.
 * `counts` is per status for the tab badges, under the same mode and dates.
 */
export async function listOrders(store, { status, fulfilmentMode, from, to, page, limit }) {
  const scoped = (columns, options) => {
    let query = supabaseAdmin.from('orders').select(columns, options).eq('store_id', store.id);
    if (fulfilmentMode) query = query.eq('fulfilment_mode', fulfilmentMode);
    if (from) query = query.gte('placed_at', new Date(from).toISOString());
    if (to) query = query.lte('placed_at', new Date(to).toISOString());
    return query;
  };

  let query = scoped(ORDER_COLUMNS, { count: 'exact' });
  query = status ? query.in('status', status) : query.neq('status', 'pending_payment');

  const start = (page - 1) * limit;
  const [{ data, count, error }, all] = await Promise.all([
    query.order('placed_at', { ascending: false }).range(start, start + limit - 1),
    scoped('status'),
  ]);
  if (error || all.error) throw internal('Could not load the orders.');

  const counts = Object.fromEntries(ORDER_STATUSES.map((name) => [name, 0]));
  for (const row of all.data ?? []) counts[row.status] += 1;

  const rows = data ?? [];
  const extra = await related(rows);
  return { orders: rows.map((row) => summaryOf(row, extra)), counts, total: count ?? rows.length };
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function act(store, orderId, action, toStatus, { note = null, patch = {} } = {}) {
  const row = await findStoreOrder(store, orderId);
  assertAllowed(row, action);
  await transitionOrder(row, toStatus, { changedBy: 'store', note, patch });
  return getOrder(store, orderId);
}

/** `POST …/accept` — placed → accepted. */
export const acceptOrder = (store, orderId) =>
  act(store, orderId, 'accept', 'accepted', { patch: { accepted_at: new Date().toISOString() } });

/** `POST …/reject` — placed or accepted → rejected. The trigger returns the stock. */
export const rejectOrder = (store, orderId, { reason }) =>
  act(store, orderId, 'reject', 'rejected', {
    note: reason ?? null,
    patch: { rejected_at: new Date().toISOString(), cancellation_reason: reason ?? null },
  });

/** `POST …/status` — the steps in between, each only on its own fulfilment path. */
export const setOrderStatus = (store, orderId, { status }) => act(store, orderId, `status:${status}`, status);

/** `POST …/complete` — the stock leaves the shelf (migration 0030's trigger). */
export const completeOrder = (store, orderId) => act(store, orderId, 'complete', 'completed');

/** `POST …/cancel` — after accepting; a placed order is rejected instead. */
export const cancelOrder = (store, orderId, { reason }) =>
  act(store, orderId, 'cancel', 'cancelled', { note: reason, patch: { cancellation_reason: reason } });
