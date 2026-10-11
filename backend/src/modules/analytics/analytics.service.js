import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, unprocessable } from '../../lib/errors.js';
import { localDate, addDays, khataAgeing } from '../../lib/khataAgeing.js';
import { segmentFor } from '../../lib/customerSegments.js';

/**
 * Merchant analytics — roadmap §4 P4. Reproducible from source transactions,
 * with the rules stated in the response so a figure can be checked by hand:
 *
 *   period     whole local days in the store's timezone, `from` to `to`
 *              inclusive.
 *   sales      completed online orders, counted once, on the day they were
 *              completed (their final total, after any substitution), plus
 *              counter sales on the day they were rung up. Orders that were
 *              cancelled or rejected are never sales, so their refunds are
 *              not subtracted again — refunds are reported on their own.
 *   items      net item value: price × quantity less the line's share of any
 *              discount; tax and delivery excluded. Replaced lines excluded.
 *   orders     orders PLACED in the period, by their current status (online
 *              orders still awaiting payment are left out).
 *   khata      outstanding and overdue as of today (oldest charges settled
 *              first); collected and charged within the period.
 *
 * No AI here (roadmap: "Do not add AI recommendations at this stage").
 */

const fail = (error, message) => {
  if (error) throw internal(message);
};

const DAY = 86_400_000;

/** Midnight at the start of a local date, as a UTC instant. */
function startOfLocalDay(isoDate, timeZone) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess - (asLocal - guess));
}

export function resolvePeriod(store, { from, to, now = new Date() }) {
  const today = localDate(now, store.timezone);
  const end = to ?? today;
  const start = from ?? addDays(end, -29);
  if (start > end) throw unprocessable('PERIOD_INVALID', '`from` must not be after `to`.');
  const days = Math.round((Date.parse(end) - Date.parse(start)) / DAY) + 1;
  if (days > 366) throw unprocessable('PERIOD_TOO_LONG', 'Choose a period of at most a year.');
  return {
    from: start,
    to: end,
    days,
    timezone: store.timezone,
    startsAt: startOfLocalDay(start, store.timezone).toISOString(),
    endsBefore: startOfLocalDay(addDays(end, 1), store.timezone).toISOString(),
  };
}

const bucketOf = (iso, timeZone) => localDate(new Date(iso), timeZone);

export async function storeAnalytics(store, query = {}) {
  const period = resolvePeriod(store, query);
  const now = query.now ?? new Date();

  const [completed, placed, sales, refunds, products, khataAccounts] = await Promise.all([
    supabaseAdmin
      .from('orders')
      .select('id, customer_id, total_paise, completed_at')
      .eq('store_id', store.id)
      .eq('status', 'completed')
      .gte('completed_at', period.startsAt)
      .lt('completed_at', period.endsBefore),
    supabaseAdmin
      .from('orders')
      .select('id, status, placed_at, accepted_at, fulfilment_mode')
      .eq('store_id', store.id)
      .neq('status', 'pending_payment')
      .gte('placed_at', period.startsAt)
      .lt('placed_at', period.endsBefore),
    supabaseAdmin
      .from('sales')
      .select('id, total_paise, created_at')
      .eq('store_id', store.id)
      .gte('created_at', period.startsAt)
      .lt('created_at', period.endsBefore),
    supabaseAdmin
      .from('refunds')
      .select('amount_paise, kind, refunded_at')
      .eq('store_id', store.id)
      .eq('status', 'refunded')
      .gte('refunded_at', period.startsAt)
      .lt('refunded_at', period.endsBefore),
    supabaseAdmin
      .from('products')
      .select('id, name, track_inventory, is_available, low_stock_threshold')
      .eq('store_id', store.id)
      .is('archived_at', null),
    supabaseAdmin.from('khata_accounts').select('id, customer_id').eq('store_id', store.id),
  ]);
  fail(completed.error || placed.error || sales.error || refunds.error || products.error || khataAccounts.error, 'Could not compute analytics.');

  const completedRows = completed.data ?? [];
  const salesRows = sales.data ?? [];

  // ── Items sold (orders + counter) ─────────────────────────────────────────
  const [orderItems, saleItems] = await Promise.all([
    completedRows.length
      ? supabaseAdmin
          .from('order_items')
          .select('order_id, product_id, product_name, quantity, unit_price_paise, discount_paise, is_active')
          .in('order_id', completedRows.map((o) => o.id))
      : { data: [] },
    salesRows.length
      ? supabaseAdmin.from('sale_items').select('sale_id, product_id, product_name, quantity, unit_price_paise').in('sale_id', salesRows.map((s) => s.id))
      : { data: [] },
  ]);
  fail(orderItems.error || saleItems.error, 'Could not compute analytics.');

  const byProduct = new Map();
  const tally = (productId, name, units, value) => {
    if (!productId) return;
    const entry = byProduct.get(productId) ?? { productId, name, units: 0, revenuePaise: 0 };
    entry.units += units;
    entry.revenuePaise += value;
    byProduct.set(productId, entry);
  };
  for (const item of (orderItems.data ?? []).filter((i) => i.is_active !== false)) {
    tally(item.product_id, item.product_name, item.quantity, item.unit_price_paise * item.quantity - (item.discount_paise ?? 0));
  }
  for (const item of saleItems.data ?? []) tally(item.product_id, item.product_name, item.quantity, item.unit_price_paise * item.quantity);

  // ── Sales and trend ───────────────────────────────────────────────────────
  const ordersRevenue = completedRows.reduce((sum, o) => sum + o.total_paise, 0);
  const posRevenue = salesRows.reduce((sum, s) => sum + s.total_paise, 0);
  const refundRows = refunds.data ?? [];
  const trend = new Map();
  for (let i = 0; i < period.days; i += 1) {
    trend.set(addDays(period.from, i), { date: addDays(period.from, i), ordersPaise: 0, posPaise: 0, orders: 0, sales: 0, refundsPaise: 0 });
  }
  for (const o of completedRows) {
    const b = trend.get(bucketOf(o.completed_at, store.timezone));
    if (b) { b.ordersPaise += o.total_paise; b.orders += 1; }
  }
  for (const s of salesRows) {
    const b = trend.get(bucketOf(s.created_at, store.timezone));
    if (b) { b.posPaise += s.total_paise; b.sales += 1; }
  }
  for (const r of refundRows) {
    const b = trend.get(bucketOf(r.refunded_at, store.timezone));
    if (b) b.refundsPaise += r.amount_paise;
  }

  // ── Orders ────────────────────────────────────────────────────────────────
  const placedRows = placed.data ?? [];
  const statusCounts = {};
  for (const o of placedRows) statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;
  const acceptMinutes = placedRows
    .filter((o) => o.accepted_at)
    .map((o) => (new Date(o.accepted_at) - new Date(o.placed_at)) / 60_000)
    .sort((a, b) => a - b);
  const median = acceptMinutes.length ? acceptMinutes[Math.floor((acceptMinutes.length - 1) / 2)] : null;
  const ended = (statusCounts.cancelled ?? 0) + (statusCounts.rejected ?? 0);

  // ── Products: best, slow, unavailable ─────────────────────────────────────
  const productRows = (products.data ?? []).filter((p) => p.is_available);
  const { data: variants, error: variantError } = productRows.length
    ? await supabaseAdmin
        .from('product_variants')
        .select('product_id, quantity_on_hand, reserved_quantity, is_available')
        .in('product_id', productRows.map((p) => p.id))
    : { data: [], error: null };
  fail(variantError, 'Could not compute analytics.');
  const stockOf = new Map();
  for (const v of variants ?? []) {
    if (!v.is_available) continue;
    const entry = stockOf.get(v.product_id) ?? { onHand: 0, available: 0, variants: 0 };
    entry.onHand += v.quantity_on_hand;
    entry.available += v.quantity_on_hand - v.reserved_quantity;
    entry.variants += 1;
    stockOf.set(v.product_id, entry);
  }

  const ranked = [...byProduct.values()].sort((a, b) => b.units - a.units || b.revenuePaise - a.revenuePaise);
  const slow = productRows
    .filter((p) => p.track_inventory && (stockOf.get(p.id)?.onHand ?? 0) > 0)
    .map((p) => ({ productId: p.id, name: p.name, unitsSold: byProduct.get(p.id)?.units ?? 0, onHand: stockOf.get(p.id).onHand }))
    .sort((a, b) => a.unitsSold - b.unitsSold || b.onHand - a.onHand)
    .slice(0, 10);
  const unavailable = productRows
    .filter((p) => {
      const stock = stockOf.get(p.id);
      if (!stock || stock.variants === 0) return true;
      return p.track_inventory && stock.available <= 0;
    })
    .map((p) => ({
      productId: p.id,
      name: p.name,
      reason: !stockOf.get(p.id)?.variants ? 'no_active_variant' : 'out_of_stock',
      unitsSoldInPeriod: byProduct.get(p.id)?.units ?? 0,
    }));

  // ── Customers ─────────────────────────────────────────────────────────────
  const { data: allCompleted, error: allError } = await supabaseAdmin
    .from('orders')
    .select('customer_id, completed_at')
    .eq('store_id', store.id)
    .eq('status', 'completed');
  fail(allError, 'Could not compute analytics.');
  const history = new Map();
  for (const row of allCompleted ?? []) {
    if (!history.has(row.customer_id)) history.set(row.customer_id, []);
    history.get(row.customer_id).push(row.completed_at);
  }
  const segments = { new: 0, active: 0, loyal: 0, inactive: 0 };
  for (const dates of history.values()) segments[segmentFor(dates, now)] += 1;
  const buyersInPeriod = new Set(completedRows.map((o) => o.customer_id));
  let newInPeriod = 0;
  let returningInPeriod = 0;
  for (const customerId of buyersInPeriod) {
    const first = [...history.get(customerId)].sort()[0];
    if (first >= period.startsAt) newInPeriod += 1;
    else returningInPeriod += 1;
  }

  // ── Khata ─────────────────────────────────────────────────────────────────
  const accounts = khataAccounts.data ?? [];
  let khata = { outstandingPaise: 0, overduePaise: 0, collectedPaise: 0, chargedPaise: 0, accountsOverdue: 0 };
  if (accounts.length) {
    const { data: txns, error: txnError } = await supabaseAdmin
      .from('khata_transactions')
      .select('account_id, type, entry_kind, amount_paise, due_date, occurred_at, created_at')
      .in('account_id', accounts.map((a) => a.id));
    fail(txnError, 'Could not compute analytics.');
    const today = localDate(now, store.timezone);
    for (const account of accounts) {
      const entries = (txns ?? []).filter((t) => t.account_id === account.id);
      const ageing = khataAgeing(entries, today);
      khata.outstandingPaise += ageing.outstandingPaise;
      khata.overduePaise += ageing.overduePaise;
      if (ageing.overduePaise > 0) khata.accountsOverdue += 1;
    }
    for (const t of txns ?? []) {
      const at = new Date(t.occurred_at).toISOString();
      if (at < period.startsAt || at >= period.endsBefore) continue;
      if (t.entry_kind === 'payment') khata.collectedPaise += t.amount_paise;
      if (t.entry_kind === 'charge') khata.chargedPaise += t.amount_paise;
    }
  }

  const grossSalesPaise = ordersRevenue + posRevenue;
  const transactions = completedRows.length + salesRows.length;
  return {
    period,
    sales: {
      grossSalesPaise,
      ordersRevenuePaise: ordersRevenue,
      counterSalesPaise: posRevenue,
      completedOrders: completedRows.length,
      counterSales: salesRows.length,
      averageTicketPaise: transactions ? Math.round(grossSalesPaise / transactions) : 0,
      refundsPaise: refundRows.reduce((sum, r) => sum + r.amount_paise, 0),
      trend: [...trend.values()],
    },
    orders: {
      placed: placedRows.length,
      byStatus: statusCounts,
      cancellationRate: placedRows.length ? Math.round((ended / placedRows.length) * 1000) / 1000 : 0,
      medianMinutesToAccept: median === null ? null : Math.round(median),
      byFulfilment: {
        pickup: placedRows.filter((o) => o.fulfilment_mode === 'pickup').length,
        delivery: placedRows.filter((o) => o.fulfilment_mode === 'delivery').length,
      },
    },
    products: {
      bestSellers: ranked.slice(0, 10),
      slowMovers: slow,
      unavailable,
    },
    customers: {
      segments,
      buyersInPeriod: buyersInPeriod.size,
      newInPeriod,
      returningInPeriod,
    },
    khata,
    definitions: {
      sales: 'Completed online orders on their completion day (final total incl. tax and delivery), plus counter sales. Cancelled and rejected orders are never sales.',
      refunds: 'Money confirmed returned to customers in the period. Shown separately; not subtracted from sales, because the cancelled orders it relates to were never counted as sales.',
      items: 'Units and net item value (price × quantity less discount share; excluding tax and delivery) from completed orders and counter sales.',
      orders: 'Orders placed in the period, by their current status; online orders still awaiting payment are excluded.',
      segments: 'From all completed orders at this store: new (1, within 60 days), active (2+, last within 60), loyal (5+ in 180 days, last within 60), inactive (none in 60 days).',
      khata: 'Outstanding and overdue as of today, oldest charges settled first; collected = payments recorded in the period; charged = credit purchases in the period.',
    },
  };
}
