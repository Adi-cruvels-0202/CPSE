import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, notFound } from '../../lib/errors.js';
import { segmentFor, customerValue, favouriteProducts, SEGMENT_LABELS, SEGMENT_RULES } from '../../lib/customerSegments.js';
import { STATUS_LABELS } from '../orders/order.state.js';

/**
 * Merchant CRM — roadmap §4 P2: customer records kept separately per
 * merchant, purchase history, status, value, favourite products and
 * communication preferences; §6 "Customer relationship" flow.
 *
 * Everything is computed from THIS store's own transactions — another
 * merchant's orders never enter a figure here — so it is reproducible and
 * always current. The only thing stored is what the merchant writes down
 * (notes, tags). Contact details shown are the ones the customer gave this
 * store on an order, plus their profile phone; never their email.
 */

const fail = (error, message) => {
  if (error) throw internal(message);
};

const SPENDING_STATUSES = ['completed'];

async function storeOrders(storeId, customerId = null) {
  let query = supabaseAdmin
    .from('orders')
    .select('id, order_number, customer_id, status, total_paise, placed_at, completed_at, fulfilment_mode, payment_method, delivery_address')
    .eq('store_id', storeId)
    .neq('status', 'pending_payment');
  if (customerId) query = query.eq('customer_id', customerId);
  const { data, error } = await query.order('placed_at', { ascending: false });
  fail(error, 'Could not load the customers.');
  return data ?? [];
}

async function relationshipRows(store, customerIds) {
  if (customerIds.length === 0) {
    return { customers: new Map(), prefs: new Map(), notes: new Map(), khata: new Map(), loyalty: new Map(), followers: new Set() };
  }
  const [customers, prefs, notes, khata, loyalty, saved] = await Promise.all([
    supabaseAdmin.from('customers').select('id, full_name, phone').in('id', customerIds),
    supabaseAdmin.from('customer_store_preferences').select('customer_id, allow_promotions, allow_reminders, allow_sms, allow_whatsapp, allow_email').eq('store_id', store.id).in('customer_id', customerIds),
    supabaseAdmin.from('store_customer_notes').select('customer_id, notes, tags').eq('store_id', store.id).in('customer_id', customerIds),
    supabaseAdmin.from('khata_accounts').select('id, customer_id, balance_paise, credit_limit_paise').eq('store_id', store.id).in('customer_id', customerIds),
    supabaseAdmin.from('loyalty_accounts').select('customer_id, current_points').eq('store_id', store.id).in('customer_id', customerIds),
    supabaseAdmin.from('saved_stores').select('customer_id').eq('store_id', store.id).in('customer_id', customerIds),
  ]);
  fail(customers.error || prefs.error || notes.error || khata.error || loyalty.error || saved.error, 'Could not load the customers.');
  const byCustomer = (rows) => new Map((rows ?? []).map((row) => [row.customer_id ?? row.id, row]));
  return {
    customers: byCustomer(customers.data),
    prefs: byCustomer(prefs.data),
    notes: byCustomer(notes.data),
    khata: byCustomer(khata.data),
    loyalty: byCustomer(loyalty.data),
    followers: new Set((saved.data ?? []).map((row) => row.customer_id)),
  };
}

const consentOf = (pref) => ({
  promotions: pref?.allow_promotions ?? false,
  reminders: pref?.allow_reminders ?? true,
  sms: pref?.allow_sms ?? false,
  whatsapp: pref?.allow_whatsapp ?? false,
  email: pref?.allow_email ?? false,
});

function summarise(customerId, orders, rel, now) {
  const mine = orders.filter((order) => order.customer_id === customerId);
  const value = customerValue(mine);
  const segment = segmentFor(mine.filter((o) => SPENDING_STATUSES.includes(o.status)).map((o) => o.completed_at ?? o.placed_at), now);
  const profile = rel.customers.get(customerId);
  const latestContact = mine.find((order) => order.delivery_address?.phone)?.delivery_address;
  return {
    customerId,
    name: profile?.full_name ?? latestContact?.recipientName ?? null,
    phone: profile?.phone ?? latestContact?.phone ?? null,
    segment,
    segmentLabel: SEGMENT_LABELS[segment],
    ...value,
    openOrders: mine.filter((o) => !['completed', 'cancelled', 'rejected'].includes(o.status)).length,
    isFollower: rel.followers.has(customerId),
    consent: consentOf(rel.prefs.get(customerId)),
    khataBalancePaise: rel.khata.get(customerId)?.balance_paise ?? null,
    loyaltyPoints: rel.loyalty.get(customerId)?.current_points ?? null,
    tags: rel.notes.get(customerId)?.tags ?? [],
  };
}

/** The store's customers: anyone who ordered, has a khata, or has points here. */
export async function listCustomers(store, { segment, search, sort = 'last_order', page = 1, limit = 25, now = new Date() }) {
  const orders = await storeOrders(store.id);
  const [{ data: khataRows }, { data: loyaltyRows }] = await Promise.all([
    supabaseAdmin.from('khata_accounts').select('customer_id').eq('store_id', store.id),
    supabaseAdmin.from('loyalty_accounts').select('customer_id').eq('store_id', store.id),
  ]);
  const ids = [...new Set([...orders.map((o) => o.customer_id), ...(khataRows ?? []).map((r) => r.customer_id), ...(loyaltyRows ?? []).map((r) => r.customer_id)])];
  const rel = await relationshipRows(store, ids);

  let customers = ids.map((id) => summarise(id, orders, rel, now));
  const counts = Object.fromEntries(Object.keys(SEGMENT_LABELS).map((key) => [key, customers.filter((c) => c.segment === key).length]));
  if (segment) customers = customers.filter((c) => c.segment === segment);
  if (search) {
    const term = search.toLowerCase();
    customers = customers.filter((c) => c.name?.toLowerCase().includes(term) || c.phone?.includes(term));
  }
  const sorters = {
    last_order: (a, b) => String(b.lastOrderAt ?? '').localeCompare(String(a.lastOrderAt ?? '')),
    total_spend: (a, b) => b.totalSpendPaise - a.totalSpendPaise,
    orders: (a, b) => b.orderCount - a.orderCount,
    name: (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')),
  };
  customers.sort(sorters[sort]);

  const from = (page - 1) * limit;
  return {
    customers: customers.slice(from, from + limit),
    total: customers.length,
    segments: counts,
    rules: SEGMENT_RULES,
  };
}

async function itemsOf(orderIds) {
  if (orderIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('order_items')
    .select('order_id, product_id, product_name, quantity')
    .in('order_id', orderIds);
  fail(error, 'Could not load the purchases.');
  return data ?? [];
}

/** One customer, as this store knows them. Another store's customer is a 404. */
export async function getCustomer(store, customerId, { now = new Date() } = {}) {
  const orders = await storeOrders(store.id, customerId);
  const rel = await relationshipRows(store, [customerId]);
  if (orders.length === 0 && !rel.khata.has(customerId) && !rel.loyalty.has(customerId)) throw notFound('Customer');

  const completedIds = orders.filter((o) => o.status === 'completed').map((o) => o.id);
  const [items, favourites] = await Promise.all([
    itemsOf(completedIds),
    supabaseAdmin.from('favourite_products').select('product_id, created_at').eq('store_id', store.id).eq('customer_id', customerId),
  ]);
  fail(favourites.error, 'Could not load the favourites.');

  const favouriteIds = (favourites.data ?? []).map((f) => f.product_id);
  let favouriteNames = new Map();
  if (favouriteIds.length) {
    const { data } = await supabaseAdmin.from('products').select('id, name').in('id', favouriteIds);
    favouriteNames = new Map((data ?? []).map((p) => [p.id, p.name]));
  }

  return {
    ...summarise(customerId, orders, rel, now),
    notes: rel.notes.get(customerId)?.notes ?? null,
    favouriteProducts: {
      // Bought in two or more orders here.
      repeatPurchases: favouriteProducts(items),
      // Hearted by the customer in this store.
      saved: favouriteIds.map((id) => ({ productId: id, name: favouriteNames.get(id) ?? null })),
    },
    khata: rel.khata.get(customerId)
      ? { accountId: rel.khata.get(customerId).id, balancePaise: rel.khata.get(customerId).balance_paise, creditLimitPaise: rel.khata.get(customerId).credit_limit_paise ?? null }
      : null,
    purchaseHistory: orders.map((order) => ({
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      statusLabel: STATUS_LABELS[order.status] ?? order.status,
      totalPaise: order.total_paise,
      fulfilmentMode: order.fulfilment_mode,
      paymentMethod: order.payment_method,
      placedAt: order.placed_at,
      completedAt: order.completed_at ?? null,
    })),
  };
}

export async function saveNotes(store, customerId, { notes, tags }) {
  await getCustomer(store, customerId);
  const row = { store_id: store.id, customer_id: customerId };
  if (notes !== undefined) row.notes = notes;
  if (tags !== undefined) row.tags = [...new Set(tags)];
  const { error } = await supabaseAdmin.from('store_customer_notes').upsert(row, { onConflict: 'store_id,customer_id' });
  fail(error, 'Could not save the notes.');
  return getCustomer(store, customerId);
}
