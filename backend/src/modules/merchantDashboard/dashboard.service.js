import { supabaseAdmin } from '../../lib/supabase.js';
import { internal } from '../../lib/errors.js';
import { localNow } from '../../lib/openingHours.js';
import { STATUS_LABELS } from '../orders/order.state.js';

/**
 * The merchant's home screen — MERCHANT_API.md, P1 endpoints; MERCHANT_RULES §9.
 *
 * Fixes over Merchant-One's: "today" is the store's local day, not UTC's (D-2);
 * revenue counts online orders as well as counter sales (D-3); and low stock
 * uses each product's own threshold against what can still be sold (D-4).
 */

/** States an order sits in while the shop still has work to do on it. */
const OPEN = ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery'];
/** Orders that never became a sale. */
const NOT_REVENUE = ['pending_payment', 'cancelled', 'rejected'];

/** The local calendar date of an instant, in the store's timezone. */
const localDate = (instant, timezone) => localNow(timezone, new Date(instant)).date;

export async function getDashboard(store, now = new Date()) {
  const today = localDate(now, store.timezone);
  // Two days back is always enough to contain the local "today", whatever the
  // zone; the exact cut is made per row on its local date.
  const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();

  const [recentRows, salesRows, openRows, latest, products] = await Promise.all([
    supabaseAdmin.from('orders').select('status, total_paise, placed_at').eq('store_id', store.id).gte('placed_at', since),
    supabaseAdmin.from('sales').select('total_paise, created_at').eq('store_id', store.id).gte('created_at', since),
    supabaseAdmin.from('orders').select('status').eq('store_id', store.id).in('status', OPEN),
    supabaseAdmin
      .from('orders')
      .select('id, order_number, status, total_paise, placed_at, fulfilment_mode, delivery_address, customer_id')
      .eq('store_id', store.id)
      .neq('status', 'pending_payment')
      .order('placed_at', { ascending: false })
      .range(0, 4),
    supabaseAdmin
      .from('products')
      .select('id, name, low_stock_threshold, track_inventory, is_available')
      .eq('store_id', store.id)
      .eq('track_inventory', true)
      .eq('is_available', true)
      .is('archived_at', null),
  ]);
  for (const result of [recentRows, salesRows, openRows, latest, products]) {
    if (result.error) throw internal('Could not load the dashboard.');
  }

  const todaysOrders = (recentRows.data ?? []).filter(
    (row) => !NOT_REVENUE.includes(row.status) && localDate(row.placed_at, store.timezone) === today,
  );
  const todaysSales = (salesRows.data ?? []).filter((row) => localDate(row.created_at, store.timezone) === today);
  const sum = (rows) => rows.reduce((total, row) => total + row.total_paise, 0);

  const openCount = (...statuses) => (openRows.data ?? []).filter((row) => statuses.includes(row.status)).length;

  // Low stock: a threshold set, and no more than it left to sell.
  const watched = (products.data ?? []).filter((product) => product.low_stock_threshold != null);
  let lowStock = [];
  if (watched.length > 0) {
    const { data: variants, error } = await supabaseAdmin
      .from('product_variants')
      .select('id, product_id, name, sku, quantity_on_hand, reserved_quantity, is_available')
      .in('product_id', watched.map((product) => product.id));
    if (error) throw internal('Could not load the dashboard.');

    const byId = new Map(watched.map((product) => [product.id, product]));
    lowStock = (variants ?? [])
      .filter((variant) => variant.is_available)
      .map((variant) => ({ variant, product: byId.get(variant.product_id) }))
      .filter(({ variant, product }) => variant.quantity_on_hand - variant.reserved_quantity <= product.low_stock_threshold)
      .map(({ variant, product }) => ({
        productId: product.id,
        productName: product.name,
        variantId: variant.id,
        variantName: variant.name,
        sku: variant.sku ?? null,
        availableQuantity: variant.quantity_on_hand - variant.reserved_quantity,
        lowStockThreshold: product.low_stock_threshold,
      }))
      .sort((a, b) => a.availableQuantity - b.availableQuantity)
      .slice(0, 20);
  }

  return {
    date: today,
    today: {
      ordersCount: todaysOrders.length,
      ordersRevenuePaise: sum(todaysOrders),
      salesCount: todaysSales.length,
      salesRevenuePaise: sum(todaysSales),
    },
    openOrders: {
      placed: openCount('placed'),
      accepted: openCount('accepted'),
      preparing: openCount('preparing'),
      ready: openCount('ready_for_pickup', 'out_for_delivery'),
    },
    lowStock,
    recentOrders: (latest.data ?? []).map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      statusLabel: STATUS_LABELS[row.status] ?? row.status,
      fulfilmentMode: row.fulfilment_mode,
      totalPaise: row.total_paise,
      placedAt: row.placed_at,
    })),
  };
}
