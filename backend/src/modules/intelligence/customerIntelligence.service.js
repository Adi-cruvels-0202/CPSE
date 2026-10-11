import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, notFound } from '../../lib/errors.js';
import { formatPaise } from '../../lib/pricing.js';
import { findActiveStoreBySlug, findActiveStoreById, toPublicVariant, toPublicStore, holidaysFor } from '../stores/store.service.js';
import { productCards } from '../engagement/productCards.js';
import { buyAgain } from '../engagement/engagement.service.js';
import { storeOffersPublic } from '../offers/offer.service.js';
import * as engines from './engines.js';

/**
 * Customer intelligence (roadmap §5 P6, Phase E): search in plain words, a
 * basket from a typed list, "bought together", replenishment, alternatives,
 * discovery and a shopping assistant. Deterministic and read-only: every
 * result is a suggestion the customer adds through the normal cart, so no
 * stock, price or checkout rule is ever bypassed (roadmap C-74).
 */

const fail = (error, message) => {
  if (error) throw internal(message);
};
const DAY = 86_400_000;

async function storeBySlug(slug) {
  const store = await findActiveStoreBySlug(slug);
  if (!store) throw notFound('Store');
  return store;
}

/** The store's sellable catalogue with live variants, for matching. */
async function storeCatalogue(storeId) {
  const { data: products, error } = await supabaseAdmin
    .from('products')
    .select('id, store_id, category_id, name, unit, price_paise, track_inventory, is_available')
    .eq('store_id', storeId)
    .is('archived_at', null)
    .eq('is_available', true);
  fail(error, 'Could not load the shop.');
  const rows = products ?? [];
  if (rows.length === 0) return { products: [], categories: new Map(), cards: new Map() };
  const [variants, categories, cards] = await Promise.all([
    supabaseAdmin
      .from('product_variants')
      .select('id, product_id, name, sku, price_paise, mrp_paise, weight_grams, quantity_on_hand, reserved_quantity, is_available, sort_order')
      .in('product_id', rows.map((p) => p.id)),
    supabaseAdmin.from('categories').select('id, name').eq('store_id', storeId),
    productCards(rows.map((p) => p.id)),
  ]);
  fail(variants.error || categories.error, 'Could not load the shop.');
  const byProduct = new Map();
  for (const v of (variants.data ?? []).sort((a, b) => a.sort_order - b.sort_order)) {
    if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
    byProduct.get(v.product_id).push(v);
  }
  const categoryNames = new Map((categories.data ?? []).map((c) => [c.id, c.name]));
  return {
    products: rows
      .filter((p) => cards.has(p.id))
      .map((p) => ({
        ...p,
        categoryName: categoryNames.get(p.category_id) ?? null,
        variants: (byProduct.get(p.id) ?? []).map((v) => toPublicVariant(v, p)),
      })),
    categories: categoryNames,
    cards,
  };
}

const purchasableVariants = (product) => product.variants.filter((v) => v.isPurchasable);
const lineFor = (product, pick) => ({ storeId: product.store_id, productId: product.id, variantId: pick.variant.id, quantity: pick.quantity });

// ── Natural-language search (§5 P6) ─────────────────────────────────────────

export async function smartSearch(slug, { q }) {
  const store = await storeBySlug(slug);
  const parsed = engines.parseShoppingQuery(q);
  const { products, cards } = await storeCatalogue(store.id);
  const offerByVariant = new Map();
  if (parsed.onOffer) {
    const { offers } = await storeOffersPublic(slug);
    for (const o of offers) offerByVariant.set(o.variantId, o);
  }

  const results = [];
  for (const product of products) {
    const haystack = `${product.name} ${product.categoryName ?? ''}`;
    const score = parsed.words.length ? engines.coverage(parsed.words.join(' '), haystack) : parsed.onOffer ? 1 : 0;
    if (score < 0.5) continue;
    let variants = purchasableVariants(product);
    if (parsed.onOffer) variants = variants.filter((v) => offerByVariant.has(v.id));
    const price = (v) => offerByVariant.get(v.id)?.offerPricePaise ?? v.pricePaise;
    const pick = engines.packFor(parsed.size, variants);
    if (!pick) continue;
    const totalPaise = price(pick.variant) * pick.quantity;
    if (parsed.maxPricePaise && totalPaise > parsed.maxPricePaise) {
      // A smaller pack may still fit the budget.
      const cheaper = variants.filter((v) => price(v) <= parsed.maxPricePaise).sort((a, b) => price(b) - price(a))[0];
      if (!cheaper || parsed.size) continue;
      results.push(result(product, { variant: cheaper, quantity: 1, exact: false }, price(cheaper), score, cards, offerByVariant, 'Fits your budget.'));
      continue;
    }
    results.push(result(product, pick, totalPaise, score, cards, offerByVariant, pick.exact && parsed.size ? 'The size you asked for.' : null));
  }
  results.sort((a, b) => (parsed.sort === 'price' ? a.totalPaise - b.totalPaise : b.score - a.score || a.totalPaise - b.totalPaise));
  return { interpretation: engines.describeQuery(parsed, formatPaise), parsed: { words: parsed.words, size: parsed.size, maxPricePaise: parsed.maxPricePaise, sort: parsed.sort, onOffer: parsed.onOffer }, results: results.slice(0, 20) };
}

function result(product, pick, totalPaise, score, cards, offers, reason) {
  const offer = offers.get(pick.variant.id);
  return {
    product: cards.get(product.id),
    suggestion: { variantId: pick.variant.id, variantName: pick.variant.name, quantity: pick.quantity, unitPricePaise: offer?.offerPricePaise ?? pick.variant.pricePaise, pricePerKgPaise: pick.variant.pricePerKgPaise ?? null },
    totalPaise,
    score: Math.round(score * 100) / 100,
    reason: reason ?? (offer ? `On offer: ${offer.title}.` : null),
    add: lineFor(product, pick),
  };
}

// ── A basket from a typed or spoken list (§5 P6) ────────────────────────────

export async function proposeBasket(customerId, storeId, { text }) {
  const store = await findActiveStoreById(storeId);
  if (!store) throw notFound('Store');
  const lines = engines.parseShoppingList(text);
  const [{ products, cards }, usual] = await Promise.all([storeCatalogue(storeId), customerId ? buyAgain(customerId, { storeId }) : []]);
  const usualByProduct = new Map(usual.map((u) => [u.id, u]));

  const proposals = [];
  const unmatched = [];
  for (const line of lines) {
    const ranked = products
      .map((p) => ({ p, score: engines.coverage(line.words.join(' '), `${p.name} ${p.categoryName ?? ''}`) + (usualByProduct.has(p.id) ? 0.2 : 0) }))
      .filter((x) => x.score >= 0.5 && purchasableVariants(x.p).length)
      .sort((a, b) => b.score - a.score);
    if (ranked.length === 0) {
      unmatched.push({ text: line.text, reason: 'Nothing in this shop matches.' });
      continue;
    }
    const product = ranked[0].p;
    const habit = usualByProduct.get(product.id);
    let pick;
    let reason;
    if (!line.size && habit && product.variants.find((v) => v.id === habit.usualVariantId && v.isPurchasable)) {
      pick = { variant: product.variants.find((v) => v.id === habit.usualVariantId), quantity: line.quantity, exact: true };
      reason = 'The size you usually buy.';
    } else {
      pick = engines.packFor(line.size, purchasableVariants(product));
      pick = { ...pick, quantity: pick.quantity * line.quantity };
      reason = line.size ? (pick.exact ? 'Matches the size you wrote.' : 'The closest size here — check it.') : null;
    }
    proposals.push({
      text: line.text,
      product: cards.get(product.id),
      suggestion: { variantId: pick.variant.id, variantName: pick.variant.name, quantity: pick.quantity, unitPricePaise: pick.variant.pricePaise },
      linePaise: pick.variant.pricePaise * pick.quantity,
      reason,
      alternatives: ranked.slice(1, 3).map((x) => ({ productId: x.p.id, name: x.p.name })),
      add: lineFor(product, pick),
    });
  }
  return {
    storeId,
    proposals,
    unmatched,
    estimatePaise: proposals.reduce((sum, p) => sum + p.linePaise, 0),
    note: 'Nothing is in your cart yet. Add the lines you want; prices and stock are checked again at checkout.',
  };
}

// ── Bought together (§5 P6 "Product recommendations") ───────────────────────

export async function recommendations(slug, productId, { now = new Date() } = {}) {
  const store = await storeBySlug(slug);
  const since = new Date(now.getTime() - 180 * DAY).toISOString();
  const { data: orders, error } = await supabaseAdmin.from('orders').select('id').eq('store_id', store.id).eq('status', 'completed').gte('completed_at', since);
  fail(error, 'Could not load orders.');
  const orderIds = (orders ?? []).map((o) => o.id);
  const together = new Map();
  const popularity = new Map();
  if (orderIds.length) {
    const { data: items, error: itemError } = await supabaseAdmin.from('order_items').select('order_id, product_id').in('order_id', orderIds);
    fail(itemError, 'Could not load orders.');
    const byOrder = new Map();
    for (const item of items ?? []) {
      if (!item.product_id) continue;
      if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, new Set());
      byOrder.get(item.order_id).add(item.product_id);
    }
    for (const set of byOrder.values()) {
      for (const id of set) popularity.set(id, (popularity.get(id) ?? 0) + 1);
      if (!set.has(productId)) continue;
      for (const id of set) if (id !== productId) together.set(id, (together.get(id) ?? 0) + 1);
    }
  }
  const { products, cards } = await storeCatalogue(store.id);
  const self = products.find((p) => p.id === productId);
  if (!self) throw notFound('Product');
  const buyable = new Map(products.filter((p) => purchasableVariants(p).length).map((p) => [p.id, p]));

  // At least two shared orders, so one basket cannot make a "pattern".
  const pairs = [...together.entries()].filter(([id, n]) => n >= 2 && buyable.has(id)).sort((a, b) => b[1] - a[1]);
  const items = pairs.slice(0, 6).map(([id, n]) => ({ product: cards.get(id), reason: `Bought together in ${n} orders here.` }));
  if (items.length < 6 && self.category_id) {
    const seen = new Set([productId, ...items.map((i) => i.product.id)]);
    const sameCategory = [...buyable.values()]
      .filter((p) => p.category_id === self.category_id && !seen.has(p.id))
      .sort((a, b) => (popularity.get(b.id) ?? 0) - (popularity.get(a.id) ?? 0))
      .slice(0, 6 - items.length);
    for (const p of sameCategory) items.push({ product: cards.get(p.id), reason: `Also in ${self.categoryName ?? 'this category'}.` });
  }
  return { productId, items, rule: 'Products in at least two of the same completed orders here in the last 180 days, then popular ones from the same category.' };
}

// ── Alternatives (§5 P6 "Smart substitutions") ──────────────────────────────

/** Similar, buyable products at a store, for an item that is out or for comparing. */
export async function alternativesFor(storeId, productId) {
  const { products, cards } = await storeCatalogue(storeId);
  let self = products.find((p) => p.id === productId);
  if (!self) {
    // An unavailable product is not in the sellable list; read it directly.
    const { data, error } = await supabaseAdmin.from('products').select('id, store_id, category_id, name, price_paise').eq('id', productId).eq('store_id', storeId).maybeSingle();
    fail(error, 'Could not load the product.');
    if (!data) throw notFound('Product');
    self = data;
  }
  const items = products
    .filter((p) => p.id !== productId && purchasableVariants(p).length)
    .map((p) => {
      const sim = engines.similarity(self.name, p.name);
      const sameCategory = Boolean(self.category_id) && p.category_id === self.category_id;
      const ratio = self.price_paise ? p.price_paise / self.price_paise : 1;
      const close = ratio >= 0.5 && ratio <= 1.5 ? 1 - Math.abs(1 - ratio) : 0;
      return { p, sim, sameCategory, ratio, score: sim * 0.6 + (sameCategory ? 0.3 : 0) + close * 0.1 };
    })
    .filter((x) => (x.sim >= 0.25 || x.sameCategory) && x.ratio >= 0.5 && x.ratio <= 1.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => ({
      product: cards.get(x.p.id),
      reason: [x.sim >= 0.25 ? 'Similar name' : null, x.sameCategory ? 'same category' : null, `${x.ratio < 1 ? 'cheaper' : x.ratio > 1 ? 'dearer' : 'same price'}`].filter(Boolean).join(', ') + '.',
      score: Math.round(x.score * 100) / 100,
    }));
  return { productId, items };
}

export async function alternatives(slug, productId) {
  const store = await storeBySlug(slug);
  return alternativesFor(store.id, productId);
}

// ── Replenishment (§5 P6) ───────────────────────────────────────────────────

export async function replenishment(customerId, { now = new Date() } = {}) {
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select('id, completed_at, placed_at')
    .eq('customer_id', customerId)
    .eq('status', 'completed')
    .gte('completed_at', new Date(now.getTime() - 365 * DAY).toISOString());
  fail(error, 'Could not load your orders.');
  const rows = orders ?? [];
  if (rows.length === 0) return { items: [], rule: RULE };
  const at = new Map(rows.map((o) => [o.id, o.completed_at ?? o.placed_at]));
  const { data: items, error: itemError } = await supabaseAdmin.from('order_items').select('order_id, product_id, variant_id, quantity').in('order_id', rows.map((o) => o.id));
  fail(itemError, 'Could not load your orders.');
  const byProduct = new Map();
  for (const item of items ?? []) {
    if (!item.product_id) continue;
    if (!byProduct.has(item.product_id)) byProduct.set(item.product_id, { dates: new Set(), quantities: [], variants: new Map() });
    const entry = byProduct.get(item.product_id);
    entry.dates.add(at.get(item.order_id).slice(0, 10));
    entry.quantities.push(item.quantity);
    entry.variants.set(item.variant_id, (entry.variants.get(item.variant_id) ?? 0) + 1);
  }
  const candidates = [...byProduct.entries()].filter(([, e]) => e.dates.size >= 3);
  const cards = await productCards(candidates.map(([id]) => id));
  const today = now.toISOString().slice(0, 10);
  const out = [];
  for (const [id, entry] of candidates) {
    if (!cards.has(id)) continue;
    const dates = [...entry.dates].sort();
    const gaps = dates.slice(1).map((d, i) => (Date.parse(d) - Date.parse(dates[i])) / DAY);
    const every = Math.round(engines.median(gaps));
    if (!every || every < 1) continue;
    const last = dates[dates.length - 1];
    const due = new Date(Date.parse(last) + every * DAY).toISOString().slice(0, 10);
    const inDays = Math.round((Date.parse(due) - Date.parse(today)) / DAY);
    out.push({
      product: cards.get(id),
      everyDays: every,
      lastBoughtOn: last,
      dueOn: due,
      dueInDays: inDays,
      status: inDays <= 0 ? 'due' : inDays <= 3 ? 'soon' : 'later',
      usualQuantity: Math.round(engines.median(entry.quantities)),
      usualVariantId: [...entry.variants.entries()].sort((a, b) => b[1] - a[1])[0][0],
      basedOnOrders: dates.length,
    });
  }
  out.sort((a, b) => a.dueInDays - b.dueInDays);
  return { items: out, rule: RULE };
}
const RULE = 'Products you bought on 3 or more days in the last year; due when the usual gap (the median between purchases) has passed since the last one.';

// ── Personal discovery (§5 P6) ──────────────────────────────────────────────

export async function discover(customerId, storeId, { now = new Date() } = {}) {
  const store = await findActiveStoreById(storeId);
  if (!store) throw notFound('Store');
  const [{ products, cards, categories }, history] = await Promise.all([storeCatalogue(storeId), buyAgain(customerId, { storeId, limit: 200 })]);
  const bought = new Set(history.map((h) => h.id));
  const categoryCounts = new Map();
  for (const h of history) if (h.categoryId) categoryCounts.set(h.categoryId, (categoryCounts.get(h.categoryId) ?? 0) + h.timesBought);
  const favouriteCategories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);

  const since = new Date(now.getTime() - 90 * DAY).toISOString();
  const { data: orders } = await supabaseAdmin.from('orders').select('id').eq('store_id', storeId).eq('status', 'completed').gte('completed_at', since);
  const popularity = new Map();
  if ((orders ?? []).length) {
    const { data: items } = await supabaseAdmin.from('order_items').select('product_id').in('order_id', orders.map((o) => o.id));
    for (const item of items ?? []) if (item.product_id) popularity.set(item.product_id, (popularity.get(item.product_id) ?? 0) + 1);
  }
  const fresh = products.filter((p) => !bought.has(p.id) && purchasableVariants(p).length);
  const picks = favouriteCategories.length
    ? fresh.filter((p) => favouriteCategories.includes(p.category_id)).sort((a, b) => (popularity.get(b.id) ?? 0) - (popularity.get(a.id) ?? 0))
    : fresh.sort((a, b) => (popularity.get(b.id) ?? 0) - (popularity.get(a.id) ?? 0));
  const { offers } = await storeOffersPublic(store.slug);
  return {
    basedOn: favouriteCategories.length ? 'your_categories' : 'popular_here',
    items: picks.slice(0, 10).map((p) => ({
      product: cards.get(p.id),
      reason: favouriteCategories.includes(p.category_id) ? `New to you, from ${categories.get(p.category_id) ?? 'a category'} you often buy.` : 'Popular at this shop.',
    })),
    offers: offers.filter((o) => !favouriteCategories.length || favouriteCategories.includes(products.find((p) => p.id === o.productId)?.category_id)).slice(0, 5),
    note: 'From your own orders at this shop only. Turn off activity in Preferences and nothing new is remembered.',
  };
}

// ── Shopping assistant (Phase E, grounded) ──────────────────────────────────

/**
 * Answers a customer's question from this shop's live data — hours, delivery,
 * offers, sizes and prices, their last order — or turns a list into a basket
 * proposal. It never adds to the cart or places an order: every action it
 * offers goes back through the cart and checkout (roadmap C-74).
 */
export async function shopAssistant(slug, customerId, { message }) {
  const m = String(message).toLowerCase();
  const store = await storeBySlug(slug);
  const publicStore = toPublicStore(store, { holidays: await holidaysFor(store.id) });

  if (/\b(open|close|closing|timing|hours|when)\b/.test(m) && !/\bhow much\b/.test(m)) {
    const h = publicStore.hours;
    return { kind: 'answer', intent: 'hours', answer: h.isOpen ? `${store.name} is open now${h.closesAt ? `, until ${h.closesAt}` : ''}.` : `${store.name} is closed now${h.opensAt ? `; it opens at ${h.opensAt}${h.opensOn ? ` on ${h.opensOn}` : ''}` : ''}. You can still order.`, source: 'Store hours, in the shop’s time zone.' };
  }
  if (/\b(deliver|delivery|minimum|min order|pickup|pick up)\b/.test(m)) {
    const f = publicStore.fulfilment;
    const parts = [
      f.deliveryEnabled ? `Delivery ${f.deliveryFeePaise ? `costs ${formatPaise(f.deliveryFeePaise)}` : 'is free'}${f.freeDeliveryThresholdPaise ? `, free over ${formatPaise(f.freeDeliveryThresholdPaise)}` : ''}${f.deliveryRadiusKm ? ` within ${f.deliveryRadiusKm} km` : ''}.` : 'No delivery from this shop.',
      f.pickupEnabled ? 'Pickup is available.' : null,
      f.minOrderPaise ? `Minimum order ${formatPaise(f.minOrderPaise)}.` : null,
    ].filter(Boolean);
    return { kind: 'answer', intent: 'fulfilment', answer: parts.join(' '), source: 'The shop’s delivery settings.' };
  }
  if (/\b(offer|offers|discount|deal|coupon|sale)\b/.test(m) && engines.tokens(m.replace(/\b(any|offers?|discounts?|deals?|coupons?|sale|today|here|now)\b/g, '')).length === 0) {
    const { offers, coupons } = await storeOffersPublic(slug, customerId);
    return {
      kind: 'answer', intent: 'offers',
      answer: offers.length || coupons.length
        ? [offers.length ? `On offer: ${offers.slice(0, 5).map((o) => `${o.productName} at ${formatPaise(o.offerPricePaise)}`).join(', ')}.` : null, coupons.length ? `Coupons: ${coupons.slice(0, 3).map((c) => c.code).join(', ')}.` : null].filter(Boolean).join(' ')
        : 'No offers here right now.',
      offers, coupons, source: 'Live offers and the coupons you can use.',
    };
  }
  if (/\b(last time|last order|usual|again|same as before|regular)\b/.test(m)) {
    if (!customerId) return { kind: 'sign_in', intent: 'history', answer: 'Sign in and I can bring back what you usually buy here.' };
    const usual = await buyAgain(customerId, { storeId: store.id, limit: 10 });
    return {
      kind: 'proposal', intent: 'history',
      answer: usual.length ? `You usually buy: ${usual.slice(0, 5).map((u) => u.name).join(', ')}.` : 'You have no completed orders here yet.',
      proposals: usual.filter((u) => u.isPurchasable).map((u) => ({ product: u, add: { storeId: store.id, productId: u.id, variantId: u.usualVariantId, quantity: u.usualQuantity ?? 1 } })),
      source: 'Your completed orders at this shop.',
    };
  }
  if (/[,;\n]|\band\b/.test(m) && engines.parseShoppingList(m).length >= 2) {
    const basket = await proposeBasket(customerId, store.id, { text: message });
    return { kind: 'proposal', intent: 'basket', answer: `Here is a basket for your list — ${formatPaise(basket.estimatePaise)} before delivery and GST. Add what you want.`, ...basket, source: 'This shop’s catalogue and your usual sizes.' };
  }
  const compare = /\b(compare|which is cheaper|per kg|value)\b/.test(m);
  const query = compare ? m.replace(/\b(compare|which is cheaper|cheaper|per kg|value|for money|sizes?)\b/g, ' ').trim() || m : message;
  const search = await smartSearch(slug, { q: query });
  return {
    kind: 'results', intent: compare ? 'compare' : 'search',
    answer: search.results.length
      ? compare
        ? `Compared per kg where the weight is known: ${search.results.filter((r) => r.suggestion.pricePerKgPaise).sort((a, b) => a.suggestion.pricePerKgPaise - b.suggestion.pricePerKgPaise).slice(0, 3).map((r) => `${r.product.name} ${r.suggestion.variantName} at ${formatPaise(r.suggestion.pricePerKgPaise)}/kg`).join(', ') || 'no weights to compare.'}`
        : `I found ${search.results.length} for “${search.interpretation || message}”.`
      : `Nothing here matches “${search.interpretation || message}”.`,
    interpretation: search.interpretation,
    results: search.results,
    source: 'This shop’s live catalogue.',
  };
}
