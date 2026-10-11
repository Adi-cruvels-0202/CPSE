import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, unprocessable } from '../../lib/errors.js';
import { formatPaise } from '../../lib/pricing.js';
import { INDUSTRY_TEMPLATES } from '../../lib/industryTemplates.js';
import * as engines from './engines.js';
import { storeAnalytics } from '../analytics/analytics.service.js';
import { lowStockFor, purchaseSuggestions } from '../automation/automation.service.js';

/**
 * Merchant intelligence (roadmap §4 Phase D/E): forecasts, stock health,
 * catalogue suggestions, invoice reading, commands, a grounded assistant and
 * privacy-safe area benchmarks. Read-only by construction — every function
 * here only SELECTs; what it suggests is applied, after the merchant
 * confirms, through the ordinary endpoint named in the proposal.
 */

const fail = (error, message) => {
  if (error) throw internal(message);
};

const DAY = 86_400_000;

/** A date as the store's own calendar day. */
function localDay(iso, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

async function catalogue(store) {
  const { data: products, error } = await supabaseAdmin
    .from('products')
    .select('id, name, category_id, unit, tax_percent, track_inventory, is_available, low_stock_threshold, created_at')
    .eq('store_id', store.id)
    .is('archived_at', null);
  fail(error, 'Could not load the catalogue.');
  const rows = products ?? [];
  if (rows.length === 0) return { products: [], variants: [] };
  const { data: variants, error: variantError } = await supabaseAdmin
    .from('product_variants')
    .select('id, product_id, name, sku, barcode, weight_grams, price_paise, cost_paise, quantity_on_hand, reserved_quantity, is_available')
    .in('product_id', rows.map((p) => p.id));
  fail(variantError, 'Could not load the catalogue.');
  return { products: rows, variants: variants ?? [] };
}

/** Units leaving the shelf through orders and counter sales, per variant per local day. */
async function dailySales(store, { days = 56, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * DAY).toISOString();
  const { data, error } = await supabaseAdmin
    .from('inventory_ledger')
    .select('variant_id, on_hand_change, created_at')
    .eq('store_id', store.id)
    .in('movement_type', ['order_fulfilled', 'sale'])
    .gte('created_at', since);
  fail(error, 'Could not load sales.');
  const byVariant = new Map();
  for (const row of data ?? []) {
    const date = localDay(row.created_at, store.timezone ?? 'Asia/Kolkata');
    if (!byVariant.has(row.variant_id)) byVariant.set(row.variant_id, new Map());
    const days_ = byVariant.get(row.variant_id);
    days_.set(date, (days_.get(date) ?? 0) - row.on_hand_change);
  }
  return byVariant;
}

const label = (product, variant) => `${product.name}${variant && variant.name !== 'Default' ? ` (${variant.name})` : ''}`;

// ── Forecast and stock health (Phase D) ─────────────────────────────────────

export async function demandAndStock(store, { horizonDays = 14, leadDays = 7, now = new Date() } = {}) {
  const today = localDay(now.toISOString(), store.timezone ?? 'Asia/Kolkata');
  const [{ products, variants }, sales] = await Promise.all([catalogue(store), dailySales(store, { now })]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const thirtyAgo = engines.isoDay(Date.parse(`${today}T00:00:00Z`) - 30 * DAY);

  const items = [];
  for (const variant of variants) {
    const product = productById.get(variant.product_id);
    if (!product || !product.is_available || !variant.is_available) continue;
    const history = [...(sales.get(variant.id) ?? new Map()).entries()].map(([date, units]) => ({ date, units }));
    const forecast = engines.forecastDemand(history, { today, horizonDays, firstSeen: localDay(product.created_at, store.timezone ?? 'Asia/Kolkata') });
    const soldLast30 = history.filter((h) => h.date >= thirtyAgo).reduce((sum, h) => sum + h.units, 0);
    const available = product.track_inventory ? variant.quantity_on_hand - variant.reserved_quantity : null;
    const health = available === null
      ? { status: 'untracked', daysOfCover: null, note: 'Stock is not counted for this product.' }
      : engines.stockHealth({ available, dailyRate: forecast.dailyAverage, leadDays, soldLast30 });
    const reorder = available !== null && forecast.dailyAverage && (health.status === 'at_risk' || health.status === 'stockout')
      ? Math.max(Math.ceil(forecast.dailyAverage * (leadDays + horizonDays)) - Math.max(available, 0), 1)
      : null;
    items.push({
      productId: product.id,
      variantId: variant.id,
      name: label(product, variant),
      available,
      soldLast30,
      forecast: { confidence: forecast.confidence, reason: forecast.reason, dailyAverage: forecast.dailyAverage, nextDaysUnits: forecast.forecastUnits, horizonDays },
      health,
      // A proposal only: the merchant turns it into a draft purchase.
      proposedReorderQuantity: reorder,
    });
  }
  const order = { stockout: 0, at_risk: 1, overstock: 2, slow: 3, healthy: 4, unknown: 5, untracked: 6 };
  items.sort((a, b) => order[a.health.status] - order[b.health.status] || (b.forecast.dailyAverage ?? 0) - (a.forecast.dailyAverage ?? 0));
  const counts = {};
  for (const item of items) counts[item.health.status] = (counts[item.health.status] ?? 0) + 1;
  return {
    today,
    horizonDays,
    leadDays,
    counts,
    items,
    method: 'Deterministic: average daily sales over the last 28 days, shaped by weekday when there are 4+ weeks of history. No forecast with under 14 days of history or under 3 selling days.',
  };
}

// ── Catalogue suggestions (Phase D "Smart suggestions") ─────────────────────

const UNIT_HINTS = [
  [/\b\d+(\.\d+)?\s*(kg|kgs|kilo)\b/i, 'kg'], [/\b\d+\s*(g|gm|gms|grams?)\b/i, 'g'], [/\b\d+(\.\d+)?\s*(l|ltr|litres?|liters?)\b/i, 'l'],
  [/\b\d+\s*ml\b/i, 'ml'], [/\bdozen\b/i, 'dozen'], [/\b(pack|packet)\b/i, 'pack'], [/\bbox\b/i, 'box'], [/\bpair\b/i, 'pair'],
];

export async function suggestForProduct(store, { name }) {
  const { products, variants } = await catalogue(store);
  const { data: categories, error } = await supabaseAdmin.from('categories').select('id, name').eq('store_id', store.id);
  fail(error, 'Could not load categories.');
  const categoryById = new Map((categories ?? []).map((c) => [c.id, c]));

  const similarOwn = products
    .map((p) => ({ product: p, score: engines.similarity(name, p.name) }))
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // The industry templates are a second opinion on category, unit and GST.
  const templateMatches = Object.entries(INDUSTRY_TEMPLATES)
    .flatMap(([industry, t]) => t.products.map((p) => ({ industry, product: p, score: engines.similarity(name, p.name) })))
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score);
  const template = templateMatches[0] ?? null;

  let category = null;
  const own = similarOwn.find((x) => x.product.category_id && categoryById.has(x.product.category_id));
  if (own) {
    category = { id: own.product.category_id, name: categoryById.get(own.product.category_id).name, reason: `Like your “${own.product.name}”.` };
  } else if (template) {
    const existing = (categories ?? []).find((c) => engines.similarity(c.name, template.product.category) >= 0.5);
    category = existing
      ? { id: existing.id, name: existing.name, reason: `Shops usually put ${template.product.name} under ${template.product.category}.` }
      : { id: null, name: template.product.category, reason: `A new category; shops usually put ${template.product.name} here.` };
  }

  const hint = UNIT_HINTS.find(([re]) => re.test(name));
  const unit = hint ? { value: hint[1], reason: 'From the size in the name.' } : template ? { value: template.product.unit, reason: `Usual for ${template.product.name}.` } : null;
  const size = engines.parseSize(name).size;
  const ownTax = similarOwn.find((x) => x.product.tax_percent !== null);
  const taxPercent = ownTax
    ? { value: Number(ownTax.product.tax_percent), reason: `Same as your “${ownTax.product.name}”.` }
    : template
      ? { value: template.product.taxPercent, reason: 'The usual GST rate for this kind of product — confirm with your accountant.' }
      : null;

  const duplicates = similarOwn.filter((x) => x.score >= 0.99).map((x) => ({ productId: x.product.id, name: x.product.name }));
  const variantsOf = (productId) => variants.filter((v) => v.product_id === productId);
  return {
    name,
    suggestions: {
      category,
      unit,
      taxPercent,
      weightGrams: size?.grams ? { value: size.grams, reason: 'From the size in the name.' } : null,
      variants: template ? template.product.variants.map((v) => ({ name: v.name, suggestedPricePaise: v.pricePaise, weightGrams: v.weightGrams ?? null })) : [],
    },
    duplicates,
    related: similarOwn.filter((x) => x.score < 0.99).map((x) => ({ productId: x.product.id, name: x.product.name, prices: variantsOf(x.product.id).map((v) => v.price_paise) })),
    nextActions: [
      ...(duplicates.length ? [{ type: 'review_duplicate', text: `You already have “${duplicates[0].name}”. Add a size to it instead?` }] : []),
      { type: 'add_barcode', text: 'Add the barcode so the till can scan it.' },
    ],
    note: 'Suggestions only — nothing is saved until you save the product.',
  };
}

// ── Invoice text → draft purchase lines (Phase D "Invoice extraction") ──────

export async function extractInvoice(store, { text }, { now = new Date() } = {}) {
  const parsed = engines.parseInvoiceText(text, { today: localDay(now.toISOString(), store.timezone ?? 'Asia/Kolkata') });
  if (parsed.lines.length === 0) {
    throw unprocessable('NOTHING_READ', 'No item lines could be read. Each line needs a name, a quantity and a price, e.g. “Basmati Rice 10 x 95”.', { skipped: parsed.skipped.slice(0, 20) });
  }
  const { products, variants } = await catalogue(store);
  const productById = new Map(products.map((p) => [p.id, p]));
  const candidates = variants.filter((v) => productById.get(v.product_id)?.track_inventory).map((v) => ({ variant: v, product: productById.get(v.product_id), label: label(productById.get(v.product_id), v) }));

  const lines = parsed.lines.map((line) => {
    const bySku = candidates.find((c) => c.variant.sku && line.name.toLowerCase().includes(c.variant.sku.toLowerCase()));
    const ranked = candidates
      .map((c) => {
        const nameScore = Math.max(engines.similarity(line.name, c.label), engines.coverage(c.product.name, line.name) * 0.9);
        const fit = engines.sizeFit(engines.parseSize(line.name).size, { weightGrams: c.variant.weight_grams, name: c.variant.name });
        return { c, score: nameScore + (fit === null ? 0 : fit * 0.3) };
      })
      .sort((a, b) => b.score - a.score);
    const best = bySku ? { c: bySku, score: 2 } : ranked[0];
    const matched = best && best.score >= 0.5 ? best.c : null;
    return {
      source: line.source,
      readAs: { name: line.name, quantity: line.quantity, unitCostPaise: line.unitCostPaise, batchNumber: line.batchNumber, expiresOn: line.expiresOn },
      match: matched ? { productId: matched.product.id, variantId: matched.variant.id, name: matched.label, lastCostPaise: matched.variant.cost_paise ?? null } : null,
      confidence: !matched ? 'none' : bySku ? 'high' : best.score >= 0.9 ? 'high' : best.score >= 0.65 ? 'medium' : 'low',
      warnings: [
        ...line.warnings,
        ...(matched && matched.variant.cost_paise && Math.abs(line.unitCostPaise - matched.variant.cost_paise) > matched.variant.cost_paise * 0.25
          ? [`Cost ${formatPaise(line.unitCostPaise)} is far from your last ${formatPaise(matched.variant.cost_paise)} — check the line.`]
          : []),
      ],
      alternatives: ranked.slice(1, 4).filter((r) => r.score >= 0.34).map((r) => ({ variantId: r.c.variant.id, name: r.c.label })),
    };
  });
  // The supplier as written, and which of the shop's saved suppliers it is (if any).
  let supplier = null;
  if (parsed.supplier) {
    const { data: saved, error } = await supabaseAdmin.from('suppliers').select('id, name').eq('store_id', store.id).eq('is_active', true);
    fail(error, 'Could not load the suppliers.');
    const best = (saved ?? [])
      .map((s) => ({ s, score: engines.similarity(parsed.supplier.name, s.name) }))
      .sort((a, b) => b.score - a.score)[0];
    supplier = {
      ...parsed.supplier,
      match: best && best.score >= 0.6 ? { supplierId: best.s.id, name: best.s.name } : null,
    };
  }
  return {
    supplier,
    invoiceNumber: parsed.invoiceNumber,
    invoiceDate: parsed.invoiceDate,
    statedTotalPaise: parsed.statedTotalPaise,
    computedTotalPaise: parsed.computedTotalPaise,
    totalMatches: parsed.totalMatches,
    lines,
    skipped: parsed.skipped,
    warnings: parsed.warnings,
    // Applied only by saving a purchase (POST /merchant/stores/:storeId/purchases) after review.
    note: 'Nothing is saved. Check each line, then create the purchase as a draft.',
  };
}

// ── Commands and the assistant (Phase D/E) ──────────────────────────────────

function resolveProduct(products, variants, phrase) {
  const { size, rest } = engines.parseSize(phrase);
  const ranked = products
    .map((p) => ({ product: p, score: Math.max(engines.similarity(rest || phrase, p.name), engines.coverage(rest || phrase, p.name) * 0.95) }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return { status: 'not_found' };
  const top = ranked.filter((x) => x.score >= ranked[0].score - 0.01);
  if (top.length > 1) return { status: 'ambiguous', options: top.slice(0, 5).map((x) => ({ productId: x.product.id, name: x.product.name })) };
  const product = ranked[0].product;
  const own = variants.filter((v) => v.product_id === product.id);
  let variant = own.length === 1 ? own[0] : null;
  if (!variant && size) {
    const fits = own.map((v) => ({ v, fit: engines.sizeFit(size, { weightGrams: v.weight_grams, name: v.name }) ?? 0 })).sort((a, b) => b.fit - a.fit);
    if (fits[0]?.fit >= 0.999) variant = fits[0].v;
  }
  return { status: 'ok', product, variant, variants: own };
}

/**
 * A typed or spoken instruction → a proposal to confirm (roadmap Phase D
 * "Voice input → proposed structured actions"; E-06). The proposal names the
 * ordinary endpoint that applies it; this function changes nothing.
 */
export async function proposeCommand(store, { text }) {
  const command = engines.parseMerchantCommand(text);
  if (!command) return { understood: false, text, help: COMMAND_HELP };
  const { products, variants } = await catalogue(store);
  const found = resolveProduct(products, variants, command.product);
  if (found.status === 'not_found') return { understood: true, command, proposal: null, problem: `No product matches “${command.product}”.` };
  if (found.status === 'ambiguous') return { understood: true, command, proposal: null, problem: `More than one product matches “${command.product}”. Say which.`, options: found.options };

  const base = `/merchant/stores/${store.id}`;
  const { product, variant } = found;
  const needsVariant = ['stock_in', 'stock_out', 'set_price'].includes(command.type) && !variant;
  if (needsVariant) {
    return {
      understood: true, command, proposal: null,
      problem: `${product.name} comes in ${found.variants.length} sizes. Say which (${found.variants.map((v) => v.name).join(', ')}).`,
      options: found.variants.map((v) => ({ variantId: v.id, name: label(product, v) })),
    };
  }
  if (['stock_in', 'stock_out'].includes(command.type) && !product.track_inventory) {
    return { understood: true, command, proposal: null, problem: `${product.name} does not track stock.` };
  }
  let proposal;
  if (command.type === 'stock_in') {
    proposal = { summary: `Add ${command.quantity} × ${label(product, variant)} to stock`, apply: { method: 'POST', path: `${base}/inventory/stock-in`, body: { variantId: variant.id, quantity: command.quantity } } };
  } else if (command.type === 'stock_out') {
    const available = variant.quantity_on_hand - variant.reserved_quantity;
    if (command.quantity > available) return { understood: true, command, proposal: null, problem: `Only ${available} of ${label(product, variant)} are available to remove.` };
    proposal = { summary: `Remove ${command.quantity} × ${label(product, variant)} (${command.reason})`, apply: { method: 'POST', path: `${base}/inventory/stock-out`, body: { variantId: variant.id, quantity: command.quantity, reason: command.reason } } };
  } else if (command.type === 'set_price') {
    proposal = {
      summary: `Change ${label(product, variant)} from ${formatPaise(variant.price_paise)} to ${formatPaise(command.pricePaise)}`,
      apply: { method: 'PATCH', path: `${base}/products/${product.id}/variants/${variant.id}`, body: { pricePaise: command.pricePaise } },
      ...(Math.abs(command.pricePaise - variant.price_paise) > variant.price_paise * 0.5 ? { warning: 'That is a change of more than half the current price.' } : {}),
    };
  } else {
    const on = command.type === 'activate';
    proposal = { summary: `${on ? 'Show' : 'Hide'} ${product.name} ${on ? 'to' : 'from'} customers`, apply: { method: 'POST', path: `${base}/products/${product.id}/${on ? 'activate' : 'deactivate'}`, body: {} } };
  }
  return { understood: true, command, proposal: { ...proposal, requiresConfirmation: true }, problem: null };
}

const COMMAND_HELP = [
  'add 10 basmati rice 1 kg',
  'write off 2 bread',
  'set price of sugar to 45',
  'mark ghee out of stock',
  'how much did I sell this week?',
  'what is running low?',
  'who owes me money?',
];

const INTENTS = [
  { key: 'sales', re: /\b(sell|sold|sales|revenue|earn|made|business)\b/ },
  { key: 'best', re: /\b(best|top|most popular|fast)\b/ },
  { key: 'slow', re: /\b(slow|not selling|dead stock|stuck)\b/ },
  { key: 'low', re: /\b(low|running out|reorder|restock|finish)\b/ },
  { key: 'stockout', re: /\b(out of stock|sold out|stockout)\b/ },
  { key: 'khata', re: /\b(owe|owes|khata|credit|due|overdue|udhaar)\b/ },
  { key: 'orders', re: /\b(orders?|pending|waiting|new order)\b/ },
  { key: 'forecast', re: /\b(forecast|next week|expect|predict|demand)\b/ },
];

function periodOf(question, store, now) {
  const today = localDay(now.toISOString(), store.timezone ?? 'Asia/Kolkata');
  const back = (days) => engines.isoDay(Date.parse(`${today}T00:00:00Z`) - days * DAY);
  if (/\btoday\b/.test(question)) return { from: today, to: today, label: 'today' };
  if (/\byesterday\b/.test(question)) return { from: back(1), to: back(1), label: 'yesterday' };
  if (/\bmonth\b/.test(question)) return { from: back(29), to: today, label: 'the last 30 days' };
  return { from: back(6), to: today, label: 'the last 7 days' };
}

/**
 * The merchant assistant (roadmap Phase E): answers from the store's own
 * numbers, says where each figure comes from, and offers proposals — never
 * acts. Commands are routed to proposeCommand. No model is involved, so the
 * same question always gets the same answer for the same data.
 */
export async function askAssistant(store, { question, now = new Date() }) {
  const q = String(question).toLowerCase();
  const command = engines.parseMerchantCommand(q);
  if (command) return { kind: 'proposal', ...(await proposeCommand(store, { text: question })) };

  const intent = INTENTS.find((i) => i.re.test(q))?.key ?? null;
  if (!intent) return { kind: 'help', answer: 'I can answer questions about your sales, stock, khata and orders, and turn instructions into changes you confirm.', examples: COMMAND_HELP };

  if (['sales', 'best', 'slow'].includes(intent)) {
    const period = periodOf(q, store, now);
    const { analytics } = { analytics: await storeAnalytics(store, { from: period.from, to: period.to }) };
    if (intent === 'sales') {
      return {
        kind: 'answer', intent,
        answer: `Sales for ${period.label}: ${formatPaise(analytics.sales.grossSalesPaise)} — ${analytics.sales.completedOrders} online orders and ${analytics.sales.counterSales} counter sales; average bill ${formatPaise(analytics.sales.averageTicketPaise)}.`,
        data: { period, sales: analytics.sales },
        source: 'Reports (GET /merchant/stores/:storeId/analytics), same definitions.',
        actions: [{ type: 'open', text: 'Open Reports', to: '/analytics' }],
      };
    }
    const list = intent === 'best' ? analytics.products.bestSellers : analytics.products.slowMovers;
    return {
      kind: 'answer', intent,
      answer: list.length
        ? `${intent === 'best' ? 'Best sellers' : 'Slow movers'} for ${period.label}: ${list.slice(0, 5).map((p) => (intent === 'best' ? `${p.name} (${p.units})` : `${p.name} (${p.onHand} in stock)`)).join(', ')}.`
        : `Nothing to show for ${period.label}.`,
      data: { period, items: list.slice(0, 10) },
      source: 'Reports (GET /merchant/stores/:storeId/analytics).',
      actions: intent === 'slow' && list.length ? [{ type: 'open', text: 'Put one on a local offer', to: '/promotions' }] : [],
    };
  }

  if (intent === 'low' || intent === 'stockout') {
    const low = await lowStockFor(store);
    const health = await demandAndStock(store, { now });
    const risky = health.items.filter((i) => i.health.status === 'stockout' || i.health.status === 'at_risk');
    const lowItems = low.map(({ product, variant, available }) => ({ productId: product.id, variantId: variant.id, name: label(product, variant), available, lowStockThreshold: product.low_stock_threshold }));
    const names = [...new Set([...risky.map((i) => i.name), ...lowItems.map((i) => i.name)])];
    return {
      kind: 'answer', intent,
      answer: names.length ? `Needs attention: ${names.slice(0, 8).join(', ')}.` : 'Nothing is running low.',
      data: { lowStock: lowItems.slice(0, 20), atRisk: risky.slice(0, 20) },
      source: 'Low-stock thresholds and the stock-health forecast.',
      actions: names.length ? [{ type: 'open', text: 'See what to reorder', to: '/suggestions' }] : [],
    };
  }

  if (intent === 'forecast') {
    const health = await demandAndStock(store, { now });
    const forecastable = health.items.filter((i) => i.forecast.nextDaysUnits !== null).sort((a, b) => b.forecast.nextDaysUnits - a.forecast.nextDaysUnits);
    return {
      kind: 'answer', intent,
      answer: forecastable.length
        ? `Expected over the next ${health.horizonDays} days: ${forecastable.slice(0, 5).map((i) => `${i.name} ~${i.forecast.nextDaysUnits}`).join(', ')}.`
        : 'There is not enough sales history yet for a forecast (at least 14 days and 3 selling days per product).',
      data: { items: forecastable.slice(0, 20) },
      source: health.method,
      actions: [],
    };
  }

  if (intent === 'khata') {
    const period = periodOf(q, store, now);
    const analytics = await storeAnalytics(store, { from: period.from, to: period.to });
    return {
      kind: 'answer', intent,
      answer: `Customers owe ${formatPaise(analytics.khata.outstandingPaise)}, of which ${formatPaise(analytics.khata.overduePaise)} is overdue across ${analytics.khata.accountsOverdue} accounts.`,
      data: { khata: analytics.khata },
      source: 'Khata ledger (oldest charges settled first).',
      actions: analytics.khata.accountsOverdue ? [{ type: 'open', text: 'Open Khata', to: '/khata' }] : [],
    };
  }

  // orders
  const { data, error } = await supabaseAdmin.from('orders').select('id, status').eq('store_id', store.id).in('status', ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery']);
  fail(error, 'Could not load orders.');
  const counts = {};
  for (const row of data ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return {
    kind: 'answer', intent: 'orders',
    answer: (data ?? []).length ? `Open orders: ${Object.entries(counts).map(([s, n]) => `${n} ${s.replace(/_/g, ' ')}`).join(', ')}.` : 'No open orders.',
    data: { counts },
    source: 'Orders.',
    actions: counts.placed ? [{ type: 'open', text: 'Open Orders', to: '/orders' }] : [],
  };
}

// ── Area benchmarks (Phase E, privacy-safe) ─────────────────────────────────

/**
 * How this shop's prices compare with other shops in the same city, and what
 * sells around it — published only from at least MIN_STORES other shops, one
 * value per shop, and never naming a shop (roadmap Phase E "Privacy-safe
 * cross-store insights").
 */
export async function areaInsights(store, { now = new Date() } = {}) {
  if (!store.city) return { city: null, minStores: engines.MIN_STORES, benchmarks: [], popularNearby: [], note: 'Add your city in Store settings to compare with shops near you.' };
  const { data: stores, error } = await supabaseAdmin.from('stores').select('id').eq('city', store.city).eq('is_active', true).eq('is_published', true).neq('id', store.id);
  fail(error, 'Could not load the area.');
  const others = (stores ?? []).map((s) => s.id);
  const base = { city: store.city, minStores: engines.MIN_STORES, otherStores: others.length };
  if (others.length < engines.MIN_STORES) {
    return { ...base, benchmarks: [], popularNearby: [], note: `Fewer than ${engines.MIN_STORES} other shops in ${store.city} use CPSE, so nothing can be shown without revealing a shop.` };
  }

  const [{ products: mine, variants: myVariants }, theirProducts] = await Promise.all([
    catalogue(store),
    supabaseAdmin.from('products').select('id, store_id, name, unit').in('store_id', others).is('archived_at', null).eq('is_available', true),
  ]);
  fail(theirProducts.error, 'Could not load the area.');
  const theirs = theirProducts.data ?? [];
  const { data: theirVariants, error: tvError } = theirs.length
    ? await supabaseAdmin.from('product_variants').select('product_id, name, weight_grams, price_paise, is_available').in('product_id', theirs.map((p) => p.id))
    : { data: [], error: null };
  fail(tvError, 'Could not load the area.');

  // Price per kg when the weight is known, else per pack of the same size name.
  const productStore = new Map(theirs.map((p) => [p.id, p]));
  const contributions = new Map();
  const push = (key, storeId, value) => {
    if (!contributions.has(key)) contributions.set(key, []);
    contributions.get(key).push({ storeId, value });
  };
  for (const v of theirVariants ?? []) {
    if (!v.is_available) continue;
    const p = productStore.get(v.product_id);
    if (!p) continue;
    const k = engines.productKey(p.name);
    if (v.weight_grams) push(`${k}|kg`, p.store_id, (v.price_paise * 1000) / v.weight_grams);
    else push(`${k}|${v.name.toLowerCase()}`, p.store_id, v.price_paise);
  }

  const benchmarks = [];
  for (const v of myVariants) {
    const p = mine.find((x) => x.id === v.product_id);
    if (!p || !v.is_available) continue;
    const k = engines.productKey(p.name);
    const perKg = Boolean(v.weight_grams);
    const spread = engines.anonymousSpread(contributions.get(perKg ? `${k}|kg` : `${k}|${v.name.toLowerCase()}`) ?? []);
    if (!spread) continue;
    const mineValue = perKg ? Math.round((v.price_paise * 1000) / v.weight_grams) : v.price_paise;
    benchmarks.push({
      productId: p.id, variantId: v.id, name: label(p, v), basis: perKg ? 'per_kg' : 'per_pack',
      yourPricePaise: mineValue, area: spread,
      position: mineValue < spread.p25 ? 'below_most' : mineValue > spread.p75 ? 'above_most' : 'typical',
    });
  }

  // What sells around here that this shop does not stock: product keys
  // completed in orders at 5+ other shops in the last 30 days.
  const since = new Date(now.getTime() - 30 * DAY).toISOString();
  const { data: recentOrders, error: oError } = await supabaseAdmin.from('orders').select('id, store_id').in('store_id', others).eq('status', 'completed').gte('completed_at', since);
  fail(oError, 'Could not load the area.');
  const orderStore = new Map((recentOrders ?? []).map((o) => [o.id, o.store_id]));
  const popular = new Map();
  if (orderStore.size) {
    const { data: items, error: iError } = await supabaseAdmin.from('order_items').select('order_id, product_name').in('order_id', [...orderStore.keys()]);
    fail(iError, 'Could not load the area.');
    for (const item of items ?? []) {
      const k = engines.productKey(item.product_name);
      if (!k) continue;
      if (!popular.has(k)) popular.set(k, { name: item.product_name, stores: new Set() });
      popular.get(k).stores.add(orderStore.get(item.order_id));
    }
  }
  const myKeys = new Set(mine.map((p) => engines.productKey(p.name)));
  const popularNearby = [...popular.entries()]
    .filter(([k, v]) => v.stores.size >= engines.MIN_STORES && !myKeys.has(k))
    .sort((a, b) => b[1].stores.size - a[1].stores.size)
    .slice(0, 10)
    .map(([, v]) => ({ name: v.name, shops: v.stores.size >= 10 ? '10+' : `${engines.MIN_STORES}+` }));

  return { ...base, benchmarks, popularNearby, note: `From at least ${engines.MIN_STORES} other shops in ${store.city}, one figure per shop; no shop is named.` };
}
