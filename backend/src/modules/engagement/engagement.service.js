import { supabaseAdmin } from '../../lib/supabase.js';
import { conflict, internal, notFound } from '../../lib/errors.js';
import { productCards } from './productCards.js';
import { addItem, findActiveCart } from '../cart/cart.service.js';

/**
 * The customer's saved choices and the signals that make repeat shopping
 * quick — roadmap §5 P2 (saved shops, buy again, shopping lists and
 * templates, saved payment and delivery preferences, favourites, recently
 * viewed and purchased, smart cart), P3 (communication preferences), P6
 * (behaviour events, deterministic metrics).
 *
 * Everything is the signed-in customer's own (customerId from the verified
 * token is in every filter). Nothing here bypasses the cart: adding a list or
 * a usual basket goes through addItem, so price and stock are checked as for
 * any tap on "Add".
 */

const fail = (error, message) => {
  if (error) throw internal(message);
};

// ── Preferences and consent ─────────────────────────────────────────────────

const PROFILE_PREF_COLUMNS =
  'id, birthday_month, birthday_day, activity_tracking, occasion_offers, preferred_fulfilment, preferred_payment_method, preferred_substitution, preferred_language';

export async function getPreferences(customerId) {
  const [{ data, error }, address] = await Promise.all([
    supabaseAdmin.from('customers').select(PROFILE_PREF_COLUMNS).eq('id', customerId).maybeSingle(),
    supabaseAdmin.from('addresses').select('id').eq('customer_id', customerId).eq('is_default', true).maybeSingle(),
  ]);
  fail(error || address.error, 'Could not load your preferences.');
  return {
    birthday: data?.birthday_month ? { month: data.birthday_month, day: data.birthday_day } : null,
    activityTracking: data?.activity_tracking ?? true,
    occasionOffers: data?.occasion_offers ?? false,
    preferredFulfilment: data?.preferred_fulfilment ?? null,
    // A method name only. No card, UPI or bank detail is ever stored.
    preferredPaymentMethod: data?.preferred_payment_method ?? null,
    preferredSubstitution: data?.preferred_substitution ?? 'contact_me',
    preferredLanguage: data?.preferred_language ?? null,
    defaultAddressId: address.data?.id ?? null,
  };
}

export async function updatePreferences(customerId, input) {
  const patch = {};
  if (input.birthday !== undefined) {
    patch.birthday_month = input.birthday?.month ?? null;
    patch.birthday_day = input.birthday?.day ?? null;
  }
  const map = {
    activityTracking: 'activity_tracking', occasionOffers: 'occasion_offers', preferredFulfilment: 'preferred_fulfilment',
    preferredPaymentMethod: 'preferred_payment_method', preferredSubstitution: 'preferred_substitution', preferredLanguage: 'preferred_language',
  };
  for (const [key, column] of Object.entries(map)) if (input[key] !== undefined) patch[column] = input[key];
  const { error } = await supabaseAdmin.from('customers').update(patch).eq('id', customerId);
  fail(error, 'Could not save your preferences.');
  // Turning tracking off also forgets what was recorded.
  if (input.activityTracking === false) {
    const { error: purgeError } = await supabaseAdmin.from('customer_events').delete().eq('customer_id', customerId);
    fail(purgeError, 'Could not clear your activity.');
  }
  return getPreferences(customerId);
}

async function visibleStore(storeId) {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select('id, slug, name, is_active, is_published')
    .eq('id', storeId)
    .maybeSingle();
  fail(error, 'Could not load the store.');
  if (!data || !data.is_active || !data.is_published) throw notFound('Store');
  return data;
}

const toStorePrefs = (row) => ({
  allowPromotions: row?.allow_promotions ?? false,
  allowReminders: row?.allow_reminders ?? true,
  allowSms: row?.allow_sms ?? false,
  allowWhatsapp: row?.allow_whatsapp ?? false,
  allowEmail: row?.allow_email ?? false,
  // Order updates for an order you placed always reach you in the app.
  orderUpdates: 'always_in_app',
});

export async function getStorePreferences(customerId, storeId) {
  await visibleStore(storeId);
  const { data, error } = await supabaseAdmin
    .from('customer_store_preferences')
    .select('allow_promotions, allow_reminders, allow_sms, allow_whatsapp, allow_email')
    .eq('customer_id', customerId)
    .eq('store_id', storeId)
    .maybeSingle();
  fail(error, 'Could not load your preferences.');
  return toStorePrefs(data);
}

export async function setStorePreferences(customerId, storeId, input) {
  await visibleStore(storeId);
  const row = { customer_id: customerId, store_id: storeId };
  const map = { allowPromotions: 'allow_promotions', allowReminders: 'allow_reminders', allowSms: 'allow_sms', allowWhatsapp: 'allow_whatsapp', allowEmail: 'allow_email' };
  for (const [key, column] of Object.entries(map)) if (input[key] !== undefined) row[column] = input[key];
  const { error } = await supabaseAdmin.from('customer_store_preferences').upsert(row, { onConflict: 'customer_id,store_id' });
  fail(error, 'Could not save your preferences.');
  return getStorePreferences(customerId, storeId);
}

/** Every store's preferences the customer has set — the "manage communications" list. */
export async function listStorePreferences(customerId) {
  const { data, error } = await supabaseAdmin
    .from('customer_store_preferences')
    .select('store_id, allow_promotions, allow_reminders, allow_sms, allow_whatsapp, allow_email')
    .eq('customer_id', customerId);
  fail(error, 'Could not load your preferences.');
  const rows = data ?? [];
  const stores = new Map();
  if (rows.length) {
    const { data: storeRows } = await supabaseAdmin.from('stores').select('id, slug, name').in('id', rows.map((r) => r.store_id));
    for (const s of storeRows ?? []) stores.set(s.id, s);
  }
  return rows.map((row) => ({ store: stores.get(row.store_id) ?? { id: row.store_id }, ...toStorePrefs(row) }));
}

// ── Activity (behaviour events) ─────────────────────────────────────────────

async function trackingOn(customerId) {
  const { data } = await supabaseAdmin.from('customers').select('activity_tracking').eq('id', customerId).maybeSingle();
  return data?.activity_tracking ?? true;
}

/**
 * Records one event, if the customer allows it. Ids must point at visible
 * things that belong together; anything else is silently not recorded, so a
 * tracker can never be used to probe the catalogue.
 */
export async function recordEvent(customerId, input) {
  if (!(await trackingOn(customerId))) return { recorded: false, reason: 'TRACKING_OFF' };

  if (input.productId) {
    const cards = await productCards([input.productId]);
    const card = cards.get(input.productId);
    if (!card || (input.storeId && card.store.id !== input.storeId)) return { recorded: false, reason: 'NOT_FOUND' };
    input.storeId = card.store.id;
  } else if (input.storeId) {
    try {
      await visibleStore(input.storeId);
    } catch {
      return { recorded: false, reason: 'NOT_FOUND' };
    }
  }

  const { error } = await supabaseAdmin.from('customer_events').insert({
    customer_id: customerId,
    store_id: input.storeId ?? null,
    product_id: input.productId ?? null,
    variant_id: input.variantId ?? null,
    event_type: input.eventType,
    query: input.query ?? null,
    session_id: input.sessionId ?? null,
  });
  fail(error, 'Could not record the event.');
  return { recorded: true };
}

export async function recentlyViewed(customerId, { storeId, limit = 12 } = {}) {
  let query = supabaseAdmin
    .from('customer_events')
    .select('product_id, created_at')
    .eq('customer_id', customerId)
    .eq('event_type', 'product_view');
  if (storeId) query = query.eq('store_id', storeId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(200);
  fail(error, 'Could not load what you viewed.');
  const seen = new Map();
  for (const row of data ?? []) if (row.product_id && !seen.has(row.product_id)) seen.set(row.product_id, row.created_at);
  const cards = await productCards([...seen.keys()]);
  return [...seen.entries()]
    .filter(([id]) => cards.has(id))
    .slice(0, limit)
    .map(([id, at]) => ({ ...cards.get(id), viewedAt: at }));
}

// ── Purchase-based lists ────────────────────────────────────────────────────

async function completedPurchases(customerId, storeId = null) {
  let query = supabaseAdmin
    .from('orders')
    .select('id, store_id, completed_at, placed_at, total_paise, fulfilment_mode, payment_method, substitution_preference, status')
    .eq('customer_id', customerId)
    .eq('status', 'completed');
  if (storeId) query = query.eq('store_id', storeId);
  const { data: orders, error } = await query.order('completed_at', { ascending: false });
  fail(error, 'Could not load your orders.');
  const rows = orders ?? [];
  if (rows.length === 0) return { orders: [], items: [] };
  const { data: items, error: itemError } = await supabaseAdmin
    .from('order_items')
    .select('order_id, product_id, variant_id, product_name, quantity')
    .in('order_id', rows.map((o) => o.id));
  fail(itemError, 'Could not load your orders.');
  return { orders: rows, items: items ?? [] };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/** Products bought before, most often and most recently first, at today's price. */
export async function buyAgain(customerId, { storeId, limit = 20 } = {}) {
  const { orders, items } = await completedPurchases(customerId, storeId);
  const completedAt = new Map(orders.map((o) => [o.id, o.completed_at ?? o.placed_at]));
  const stats = new Map();
  for (const item of items) {
    if (!item.product_id) continue;
    const entry = stats.get(item.product_id) ?? { orders: new Set(), quantities: [], last: null, variants: new Map() };
    entry.orders.add(item.order_id);
    entry.quantities.push(item.quantity);
    entry.variants.set(item.variant_id, (entry.variants.get(item.variant_id) ?? 0) + 1);
    const at = completedAt.get(item.order_id);
    if (!entry.last || at > entry.last) entry.last = at;
    stats.set(item.product_id, entry);
  }
  const cards = await productCards([...stats.keys()]);
  return [...stats.entries()]
    .filter(([id]) => cards.has(id))
    .map(([id, entry]) => ({
      ...cards.get(id),
      timesBought: entry.orders.size,
      usualQuantity: median(entry.quantities),
      // The variant bought most often — what "buy again" should add.
      usualVariantId: [...entry.variants.entries()].sort((a, b) => b[1] - a[1])[0][0],
      lastBoughtAt: entry.last,
    }))
    .sort((a, b) => b.timesBought - a.timesBought || String(b.lastBoughtAt).localeCompare(String(a.lastBoughtAt)))
    .slice(0, limit);
}

export async function recentlyPurchased(customerId, { storeId, limit = 20 } = {}) {
  const list = await buyAgain(customerId, { storeId, limit: 200 });
  return list.sort((a, b) => String(b.lastBoughtAt).localeCompare(String(a.lastBoughtAt))).slice(0, limit);
}

/**
 * The smart cart (deterministic, no AI): the customer's usual basket at this
 * store — products in at least half of their last ten completed orders here —
 * with the usual quantity, and which of them are not in the cart right now.
 */
export async function smartCart(customerId, storeId) {
  await visibleStore(storeId);
  const { orders, items } = await completedPurchases(customerId, storeId);
  const recent = orders.slice(0, 10);
  const recentIds = new Set(recent.map((o) => o.id));
  const counts = new Map();
  for (const item of items.filter((i) => recentIds.has(i.order_id) && i.product_id)) {
    const entry = counts.get(item.product_id) ?? { orders: new Set(), quantities: [], variant: new Map() };
    entry.orders.add(item.order_id);
    entry.quantities.push(item.quantity);
    entry.variant.set(item.variant_id, (entry.variant.get(item.variant_id) ?? 0) + 1);
    counts.set(item.product_id, entry);
  }
  const threshold = Math.max(1, Math.ceil(recent.length / 2));
  const usualIds = [...counts.entries()].filter(([, entry]) => recent.length >= 2 && entry.orders.size >= threshold).map(([id]) => id);
  const cards = await productCards(usualIds);

  const cart = await findActiveCart(customerId, storeId);
  const inCart = new Set();
  if (cart) {
    const { data } = await supabaseAdmin.from('cart_items').select('product_id').eq('cart_id', cart.id);
    for (const row of data ?? []) inCart.add(row.product_id);
  }

  const usual = usualIds
    .filter((id) => cards.has(id))
    .map((id) => {
      const entry = counts.get(id);
      return {
        ...cards.get(id),
        inOrders: entry.orders.size,
        ofLastOrders: recent.length,
        usualQuantity: median(entry.quantities),
        usualVariantId: [...entry.variant.entries()].sort((a, b) => b[1] - a[1])[0][0],
        isInCart: inCart.has(id),
      };
    })
    .sort((a, b) => b.inOrders - a.inOrders || a.name.localeCompare(b.name));

  return {
    rule: 'Products in at least half of your last ten completed orders at this store.',
    basedOnOrders: recent.length,
    usual,
    missingFromCart: usual.filter((item) => !item.isInCart && item.isPurchasable),
  };
}

/** Adds the usual basket (or the missing part of it) through the normal cart path. */
export async function addUsualToCart(customerId, storeId, { onlyMissing = true } = {}) {
  const { usual, missingFromCart } = await smartCart(customerId, storeId);
  const wanted = onlyMissing ? missingFromCart : usual;
  return addCardsToCart(customerId, storeId, wanted.map((item) => ({ productId: item.id, variantId: item.usualVariantId, quantity: item.usualQuantity ?? 1, name: item.name })));
}

async function addCardsToCart(customerId, storeId, lines) {
  const added = [];
  const failed = [];
  for (const line of lines) {
    try {
      await addItem(customerId, { storeId, productId: line.productId, variantId: line.variantId ?? null, quantity: line.quantity });
      added.push({ productId: line.productId, name: line.name, quantity: line.quantity });
    } catch (error) {
      if (!error.isOperational || error.statusCode >= 500) throw error;
      failed.push({ productId: line.productId, name: line.name, code: error.code, message: error.message });
    }
  }
  return { storeId, added, failed, isComplete: failed.length === 0 };
}

// ── Favourites ──────────────────────────────────────────────────────────────

export async function listFavourites(customerId, { storeId } = {}) {
  let query = supabaseAdmin.from('favourite_products').select('product_id, created_at').eq('customer_id', customerId);
  if (storeId) query = query.eq('store_id', storeId);
  const { data, error } = await query.order('created_at', { ascending: false });
  fail(error, 'Could not load your favourites.');
  const rows = data ?? [];
  const cards = await productCards(rows.map((r) => r.product_id));
  return rows.filter((r) => cards.has(r.product_id)).map((r) => ({ ...cards.get(r.product_id), favouritedAt: r.created_at }));
}

export async function addFavourite(customerId, productId) {
  const card = (await productCards([productId])).get(productId);
  if (!card) throw notFound('Product');
  const { error } = await supabaseAdmin
    .from('favourite_products')
    .upsert({ customer_id: customerId, product_id: productId, store_id: card.store.id }, { onConflict: 'customer_id,product_id', ignoreDuplicates: true });
  fail(error, 'Could not save the favourite.');
  await recordEvent(customerId, { eventType: 'favourite_add', productId, storeId: card.store.id });
  return { productId, isFavourite: true };
}

export async function removeFavourite(customerId, productId) {
  const { error } = await supabaseAdmin.from('favourite_products').delete().eq('customer_id', customerId).eq('product_id', productId);
  fail(error, 'Could not remove the favourite.');
  return { productId, isFavourite: false };
}

// ── Shopping lists and templates ────────────────────────────────────────────

const LIST_COLUMNS = 'id, customer_id, store_id, kind, name, repeat_every_days, next_reminder_on, created_at, updated_at';
const ITEM_COLUMNS = 'id, list_id, product_id, variant_id, label, quantity, note, is_checked, created_at';

async function findList(customerId, listId) {
  const { data, error } = await supabaseAdmin.from('shopping_lists').select(LIST_COLUMNS).eq('id', listId).eq('customer_id', customerId).maybeSingle();
  fail(error, 'Could not load the list.');
  if (!data) throw notFound('Shopping list');
  return data;
}

async function shapeList(list) {
  const { data, error } = await supabaseAdmin.from('shopping_list_items').select(ITEM_COLUMNS).eq('list_id', list.id).order('created_at', { ascending: true });
  fail(error, 'Could not load the list.');
  const items = data ?? [];
  const cards = await productCards(items.map((i) => i.product_id));
  let store = null;
  if (list.store_id) {
    const { data: storeRow } = await supabaseAdmin.from('stores').select('id, slug, name').eq('id', list.store_id).maybeSingle();
    store = storeRow ?? null;
  }
  return {
    id: list.id,
    kind: list.kind,
    name: list.name,
    store,
    repeatEveryDays: list.repeat_every_days ?? null,
    nextReminderOn: list.next_reminder_on ?? null,
    items: items.map((item) => ({
      id: item.id,
      label: item.label ?? cards.get(item.product_id)?.name ?? null,
      quantity: item.quantity,
      note: item.note ?? null,
      isChecked: item.is_checked,
      variantId: item.variant_id ?? null,
      // null for a free-text line, or a product that is no longer sold.
      product: item.product_id ? cards.get(item.product_id) ?? null : null,
      isUnavailable: Boolean(item.product_id) && !cards.get(item.product_id)?.isPurchasable,
    })),
    updatedAt: list.updated_at,
  };
}

export async function listLists(customerId, { kind } = {}) {
  let query = supabaseAdmin.from('shopping_lists').select(LIST_COLUMNS).eq('customer_id', customerId);
  if (kind) query = query.eq('kind', kind);
  const { data, error } = await query.order('updated_at', { ascending: false });
  fail(error, 'Could not load your lists.');
  return Promise.all((data ?? []).map(shapeList));
}

export async function getList(customerId, listId) {
  return shapeList(await findList(customerId, listId));
}

const addDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export async function createList(customerId, input) {
  if (input.storeId) await visibleStore(input.storeId);
  const { data, error } = await supabaseAdmin
    .from('shopping_lists')
    .insert({
      customer_id: customerId,
      store_id: input.storeId ?? null,
      kind: input.kind,
      name: input.name,
      repeat_every_days: input.repeatEveryDays ?? null,
      next_reminder_on: input.repeatEveryDays ? addDays(input.repeatEveryDays) : null,
    })
    .select(LIST_COLUMNS)
    .maybeSingle();
  if (error?.code === '23514') throw conflict('A template needs a store.');
  fail(error, 'Could not create the list.');
  for (const item of input.items ?? []) await addListItem(customerId, data.id, item);
  return getList(customerId, data.id);
}

export async function updateList(customerId, listId, input) {
  await findList(customerId, listId);
  const patch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.repeatEveryDays !== undefined) {
    patch.repeat_every_days = input.repeatEveryDays;
    patch.next_reminder_on = input.repeatEveryDays ? addDays(input.repeatEveryDays) : null;
  }
  const { error } = await supabaseAdmin.from('shopping_lists').update(patch).eq('id', listId).eq('customer_id', customerId);
  fail(error, 'Could not update the list.');
  return getList(customerId, listId);
}

export async function deleteList(customerId, listId) {
  await findList(customerId, listId);
  const { error } = await supabaseAdmin.from('shopping_lists').delete().eq('id', listId).eq('customer_id', customerId);
  fail(error, 'Could not delete the list.');
}

export async function addListItem(customerId, listId, input) {
  const list = await findList(customerId, listId);
  if (input.productId) {
    const card = (await productCards([input.productId])).get(input.productId);
    if (!card) throw notFound('Product');
    if (list.store_id && card.store.id !== list.store_id) throw notFound('Product');
  }
  const { error } = await supabaseAdmin.from('shopping_list_items').insert({
    list_id: listId,
    product_id: input.productId ?? null,
    variant_id: input.variantId ?? null,
    label: input.label ?? null,
    quantity: input.quantity ?? 1,
    note: input.note ?? null,
  });
  fail(error, 'Could not add to the list.');
  await supabaseAdmin.from('shopping_lists').update({ name: list.name }).eq('id', listId);
  if (input.productId) await recordEvent(customerId, { eventType: 'list_add', productId: input.productId });
  return getList(customerId, listId);
}

export async function updateListItem(customerId, listId, itemId, input) {
  await findList(customerId, listId);
  const patch = {};
  if (input.quantity !== undefined) patch.quantity = input.quantity;
  if (input.note !== undefined) patch.note = input.note;
  if (input.isChecked !== undefined) patch.is_checked = input.isChecked;
  const { data, error } = await supabaseAdmin.from('shopping_list_items').update(patch).eq('id', itemId).eq('list_id', listId).select('id').maybeSingle();
  fail(error, 'Could not update the item.');
  if (!data) throw notFound('List item');
  return getList(customerId, listId);
}

export async function removeListItem(customerId, listId, itemId) {
  await findList(customerId, listId);
  const { data, error } = await supabaseAdmin.from('shopping_list_items').delete().eq('id', itemId).eq('list_id', listId).select('id').maybeSingle();
  fail(error, 'Could not remove the item.');
  if (!data) throw notFound('List item');
  return getList(customerId, listId);
}

/** Puts the list's products (unchecked ones) in the cart, through the normal cart rules. */
export async function addListToCart(customerId, listId, { storeId: requestedStoreId } = {}) {
  const list = await getList(customerId, listId);
  const storeId = list.store?.id ?? requestedStoreId;
  if (!storeId) throw notFound('Store');
  const lines = list.items
    .filter((item) => item.product && !item.isChecked && item.product.store.id === storeId)
    .map((item) => ({ productId: item.product.id, variantId: item.variantId ?? item.product.defaultVariantId, quantity: item.quantity, name: item.product.name }));
  const result = await addCardsToCart(customerId, storeId, lines);
  if (list.kind === 'template' && list.repeatEveryDays) {
    await supabaseAdmin.from('shopping_lists').update({ next_reminder_on: addDays(list.repeatEveryDays) }).eq('id', listId);
  }
  return {
    ...result,
    skipped: list.items
      .filter((item) => !item.product || item.product.store.id !== storeId)
      .map((item) => ({ label: item.label, reason: item.product ? 'OTHER_STORE' : 'NOT_A_PRODUCT' })),
  };
}

// ── Personal metrics (deterministic, from own orders and own events) ────────

/**
 * Roadmap §5 P6 "Deterministic customer metrics": reproducible from the
 * customer's own completed orders (and, if tracking is on, their events).
 */
export async function insights(customerId, { now = new Date() } = {}) {
  const { orders, items } = await completedPurchases(customerId);
  const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))];
  let categoryOf = new Map();
  let categoryName = new Map();
  if (productIds.length) {
    const { data } = await supabaseAdmin.from('products').select('id, category_id').in('id', productIds);
    categoryOf = new Map((data ?? []).map((p) => [p.id, p.category_id]));
    const categoryIds = [...new Set((data ?? []).map((p) => p.category_id).filter(Boolean))];
    if (categoryIds.length) {
      const { data: cats } = await supabaseAdmin.from('categories').select('id, name').in('id', categoryIds);
      categoryName = new Map((cats ?? []).map((c) => [c.id, c.name]));
    }
  }

  const byProduct = new Map();
  const byCategory = new Map();
  const orderSets = new Map();
  for (const item of items) {
    if (!item.product_id) continue;
    const entry = byProduct.get(item.product_id) ?? { name: item.product_name, orders: new Set(), units: 0 };
    entry.orders.add(item.order_id);
    entry.units += item.quantity;
    byProduct.set(item.product_id, entry);
    const category = categoryOf.get(item.product_id);
    if (category) byCategory.set(category, (byCategory.get(category) ?? new Set()).add(item.order_id));
    if (!orderSets.has(item.order_id)) orderSets.set(item.order_id, new Set());
    orderSets.get(item.order_id).add(item.product_id);
  }

  const pairs = new Map();
  for (const set of orderSets.values()) {
    const list = [...set].sort();
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
      const key = `${list[i]}|${list[j]}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }

  const storeCounts = new Map();
  for (const order of orders) storeCounts.set(order.store_id, (storeCounts.get(order.store_id) ?? 0) + 1);
  let storeNames = new Map();
  if (storeCounts.size) {
    const { data } = await supabaseAdmin.from('stores').select('id, slug, name').in('id', [...storeCounts.keys()]);
    storeNames = new Map((data ?? []).map((s) => [s.id, s]));
  }

  const mode = (values) => {
    const counts = new Map();
    for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const totalSpend = orders.reduce((sum, o) => sum + o.total_paise, 0);
  const last180 = orders.filter((o) => now - new Date(o.completed_at ?? o.placed_at) <= 180 * 86_400_000).length;
  const repeatProducts = [...byProduct.values()].filter((p) => p.orders.size >= 2).length;

  const { data: carts } = await supabaseAdmin
    .from('carts')
    .select('id, store_id, updated_at')
    .eq('customer_id', customerId)
    .is('checked_out_at', null);
  const staleCarts = [];
  for (const cart of carts ?? []) {
    if (now - new Date(cart.updated_at) < 24 * 3_600_000) continue;
    const { data: cartItems } = await supabaseAdmin.from('cart_items').select('id').eq('cart_id', cart.id).limit(1);
    if ((cartItems ?? []).length) staleCarts.push({ storeId: cart.store_id, lastUpdatedAt: cart.updated_at });
  }

  return {
    basedOn: { completedOrders: orders.length, since: orders.at(-1)?.completed_at ?? null },
    frequentProducts: [...byProduct.entries()]
      .map(([id, p]) => ({ productId: id, name: p.name, orders: p.orders.size, units: p.units }))
      .sort((a, b) => b.orders - a.orders || b.units - a.units)
      .slice(0, 10),
    frequentCategories: [...byCategory.entries()]
      .map(([id, set]) => ({ categoryId: id, name: categoryName.get(id) ?? null, orders: set.size }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 5),
    favouriteStores: [...storeCounts.entries()]
      .map(([id, count]) => ({ store: storeNames.get(id) ?? { id }, orders: count }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 5),
    purchaseFrequency: { ordersLast180Days: last180, ordersPer30Days: Math.round((last180 / 6) * 10) / 10 },
    averageOrderPaise: orders.length ? Math.round(totalSpend / orders.length) : 0,
    repeatRate: byProduct.size ? Math.round((repeatProducts / byProduct.size) * 100) / 100 : 0,
    lastPurchaseAt: orders[0]?.completed_at ?? null,
    commonBaskets: [...pairs.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => ({ products: key.split('|').map((id) => ({ productId: id, name: byProduct.get(id)?.name ?? null })), orders: count })),
    preferred: {
      fulfilment: mode(orders.map((o) => o.fulfilment_mode)),
      payment: mode(orders.map((o) => o.payment_method)),
      substitution: mode(orders.map((o) => o.substitution_preference)),
    },
    abandonedCarts: staleCarts,
    definitions: {
      repeatRate: 'Share of the distinct products you have bought that you bought in two or more orders.',
      commonBaskets: 'Pairs of products bought together in at least two of your orders.',
      abandonedCarts: 'Carts with items not changed for over 24 hours.',
    },
  };
}
