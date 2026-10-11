/**
 * The deterministic engines behind the roadmap's intelligence phase (§4 Phase
 * D/E, §5 P6). Pure functions — no database, no clock unless passed in, no
 * model — so every number they produce can be reproduced and explained, and
 * every one is unit-tested (tests/intelligence.test.js).
 *
 * The rule they all follow (roadmap §4 E-06, §5 P6): they PROPOSE. Nothing
 * here, or in the services that call it, writes a row; a proposal is applied
 * only when a person confirms it through the ordinary endpoint.
 */

// ── Text ────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'for', 'with', 'to', 'in', 'on', 'my', 'me', 'i', 'some', 'any', 'please', 'pls',
  'want', 'need', 'get', 'buy', 'show', 'find', 'is', 'are', 'there', 'do', 'you', 'have', 'pack', 'packet', 'pcs', 'piece', 'pieces',
  // Units say how much, not what: "Rice 5kg" and "Rice" are the same product.
  'kg', 'kilo', 'kilogram', 'gm', 'gram', 'gr', 'ml', 'ltr', 'litre', 'liter', 'unit', 'nos', 'no',
]);

/** Lower-case word tokens, singularised a little, without filler words or numbers. */
export function tokens(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[₹]/g, ' ')
    .split(/[^a-z\u0900-\u097f]+/)
    .map(singular)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Plurals to singular, for the endings shop names actually use. */
function singular(word) {
  if (word.length <= 3 || word.endsWith('ss')) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (/(ch|sh|x)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** Jaccard similarity of two names' token sets, 0…1. */
export function similarity(a, b) {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared += 1;
  return shared / (x.size + y.size - shared);
}

/** How much of the query's words a name covers, 0…1 (search, not symmetry). */
export function coverage(query, name) {
  const q = tokens(query);
  if (q.length === 0) return 0;
  const n = new Set(tokens(name));
  return q.filter((t) => n.has(t) || [...n].some((w) => w.startsWith(t) || t.startsWith(w))).length / q.length;
}

/** A key for "the same product" across shops: sorted tokens. */
export const productKey = (name) => [...new Set(tokens(name))].sort().join(' ');

// ── Quantities and prices in free text ──────────────────────────────────────

const UNIT_GRAMS = { kg: 1000, kgs: 1000, kilo: 1000, kilos: 1000, kilogram: 1000, kilograms: 1000, g: 1, gm: 1, gms: 1, gram: 1, grams: 1, gr: 1 };
const UNIT_ML = { l: 1000, ltr: 1000, litre: 1000, liter: 1000, litres: 1000, liters: 1000, ml: 1 };
const COUNT_UNITS = { dozen: 12, doz: 12 };

/**
 * Pulls a size ("2 kg", "500g", "1.5 litre", "a dozen") out of a phrase.
 * Returns { grams } or { millilitres } or { count } (or null) and the rest.
 */
export function parseSize(text) {
  const source = String(text ?? '').toLowerCase();
  const match = source.match(/(\d+(?:\.\d+)?)\s*(kgs?|kilos?|kilograms?|grams?|gms?|gm|gr|g|litres?|liters?|ltr|ml|l|dozen|doz)\b/);
  if (!match) {
    if (/\b(a|one)\s+dozen\b/.test(source)) return { size: { count: 12 }, rest: source.replace(/\b(a|one)\s+dozen\b/, ' ').trim() };
    return { size: null, rest: source };
  }
  const amount = Number(match[1]);
  const unit = match[2];
  let size = null;
  if (UNIT_GRAMS[unit] !== undefined) size = { grams: Math.round(amount * UNIT_GRAMS[unit]) };
  else if (UNIT_ML[unit] !== undefined) size = { millilitres: Math.round(amount * UNIT_ML[unit]) };
  else if (COUNT_UNITS[unit] !== undefined) size = { count: Math.round(amount * COUNT_UNITS[unit]) };
  return { size, rest: (source.slice(0, match.index) + ' ' + source.slice(match.index + match[0].length)).trim() };
}

/** "under 150", "below ₹200", "less than 99.50", "< 80", "max 300" → paise. */
export function parsePriceCeiling(text) {
  const source = String(text ?? '').toLowerCase();
  const match = source.match(/(?:under|below|less than|cheaper than|upto|up to|max(?:imum)?|within|<)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d{1,2})?)/);
  if (!match) return { maxPricePaise: null, rest: source };
  return {
    maxPricePaise: Math.round(Number(match[1]) * 100),
    rest: (source.slice(0, match.index) + ' ' + source.slice(match.index + match[0].length)).trim(),
  };
}

/**
 * A customer's search in their own words (roadmap §5 P6 "Natural-language
 * search"): "2 kg basmati rice under 300", "cheapest atta", "milk on offer".
 */
export function parseShoppingQuery(text) {
  const raw = String(text ?? '').trim().slice(0, 200);
  const { maxPricePaise, rest: afterPrice } = parsePriceCeiling(raw);
  const { size, rest } = parseSize(afterPrice);
  const lower = rest.toLowerCase();
  const sort = /\b(cheapest|lowest price|cheap|budget)\b/.test(lower) ? 'price' : 'relevance';
  const onOffer = /\b(on offer|offer|offers|discount|deal|sale)\b/.test(lower);
  const words = tokens(lower.replace(/\b(cheapest|lowest price|cheap|budget|on offer|offers?|discount|deals?|sale)\b/g, ' '));
  return { raw, words, size, maxPricePaise, sort, onOffer };
}

/** "Rice · about 2 kg · under ₹300 · cheapest first" — said back to the customer. */
export function describeQuery(parsed, formatPaise) {
  const parts = [];
  if (parsed.words.length) parts.push(parsed.words.join(' '));
  if (parsed.size?.grams) parts.push(`about ${parsed.size.grams >= 1000 ? `${parsed.size.grams / 1000} kg` : `${parsed.size.grams} g`}`);
  if (parsed.size?.millilitres) parts.push(`about ${parsed.size.millilitres >= 1000 ? `${parsed.size.millilitres / 1000} litre` : `${parsed.size.millilitres} ml`}`);
  if (parsed.size?.count) parts.push(`${parsed.size.count} pieces`);
  if (parsed.maxPricePaise) parts.push(`under ${formatPaise(parsed.maxPricePaise)}`);
  if (parsed.onOffer) parts.push('on offer');
  if (parsed.sort === 'price') parts.push('cheapest first');
  return parts.join(' · ');
}

/**
 * A shopping list typed or spoken in one go (roadmap §5 P6 "Smart basket"):
 * "2 kg rice, 1 litre oil and 6 eggs" → lines with a quantity and words.
 */
export function parseShoppingList(text) {
  return String(text ?? '')
    .slice(0, 2000)
    .split(/\n|,|;|\band\b|\+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((part) => {
      const { size, rest } = parseSize(part);
      // A bare leading count is a quantity: "6 eggs", "2 x bread", "bread x2".
      let quantity = 1;
      let remaining = rest;
      const lead = remaining.match(/^(\d{1,3})\s*(?:x|×|nos?\.?|pcs?)?\s+(.+)$/i);
      const tail = remaining.match(/^(.+?)\s*(?:x|×)\s*(\d{1,3})$/i);
      if (lead) {
        quantity = Number(lead[1]);
        remaining = lead[2];
      } else if (tail) {
        quantity = Number(tail[2]);
        remaining = tail[1];
      }
      return { text: part, quantity: Math.min(Math.max(quantity, 1), 99), size, words: tokens(remaining) };
    })
    .filter((line) => line.words.length > 0);
}

// ── Choosing a variant ──────────────────────────────────────────────────────

/** Closeness of a variant's size to the wanted size, 0…1 (1 = exact). */
export function sizeFit(wanted, variant) {
  if (!wanted) return null;
  if (wanted.grams && variant.weightGrams) {
    const ratio = Math.min(wanted.grams, variant.weightGrams) / Math.max(wanted.grams, variant.weightGrams);
    return ratio;
  }
  const fromName = parseSize(variant.name ?? '').size;
  if (!fromName) return 0;
  const pairs = [['grams', 'grams'], ['millilitres', 'millilitres'], ['count', 'count']];
  for (const [w, v] of pairs) {
    if (wanted[w] && fromName[v]) return Math.min(wanted[w], fromName[v]) / Math.max(wanted[w], fromName[v]);
  }
  return 0;
}

/**
 * For a wanted size, which pack(s) and how many: an exact pack, else the
 * nearest pack bought in a whole number that reaches the size.
 */
export function packFor(wanted, variants) {
  const buyable = variants.filter((v) => v.isPurchasable);
  if (buyable.length === 0) return null;
  if (!wanted) return { variant: buyable[0], quantity: 1, exact: false };
  const scored = buyable.map((variant) => ({ variant, fit: sizeFit(wanted, variant) ?? 0 })).sort((a, b) => b.fit - a.fit);
  const best = scored[0];
  if (best.fit >= 0.999) return { variant: best.variant, quantity: 1, exact: true };
  // Multiples of a smaller pack: 2 kg from 1 kg packs.
  const amount = wanted.grams ?? wanted.millilitres ?? wanted.count ?? null;
  for (const { variant } of scored) {
    const each = variant.weightGrams ?? parseSize(variant.name ?? '').size?.grams ?? parseSize(variant.name ?? '').size?.millilitres ?? parseSize(variant.name ?? '').size?.count ?? null;
    if (amount && each && amount % each === 0 && amount / each <= 20) return { variant, quantity: amount / each, exact: true };
  }
  return { variant: best.variant, quantity: 1, exact: false };
}

// ── Demand and stock ────────────────────────────────────────────────────────

const DAY = 86_400_000;

/**
 * Demand forecast for one item from daily units sold (roadmap Phase D
 * "Demand forecasting"): the average of the last 28 days, shaped by each
 * weekday's share when there are at least four weeks of history.
 *
 *   history: [{ date: 'YYYY-MM-DD', units }] (days with no sales may be absent)
 *   firstSeen: the first day this item could have sold (product creation)
 *
 * Says how sure it is, and refuses outright with too little data instead of
 * inventing a number.
 */
export function forecastDemand(history, { today, horizonDays = 14, firstSeen = null } = {}) {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const byDate = new Map();
  for (const row of history) byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.units);
  const dates = [...byDate.keys()].sort();
  const earliest = [firstSeen, dates[0]].filter(Boolean).sort()[0] ?? null;
  const spanDays = earliest ? Math.max(Math.round((todayMs - Date.parse(`${earliest}T00:00:00Z`)) / DAY), 0) : 0;
  const salesDays = dates.filter((d) => byDate.get(d) > 0 && Date.parse(`${d}T00:00:00Z`) >= todayMs - 56 * DAY).length;

  if (spanDays < 14 || salesDays < 3) {
    return {
      confidence: 'insufficient',
      reason: spanDays < 14 ? `Only ${spanDays} days of history; a forecast needs at least 14.` : `Sold on only ${salesDays} days; a forecast needs at least 3.`,
      dailyAverage: null,
      forecastUnits: null,
      days: [],
    };
  }

  const window = Math.min(28, spanDays);
  let recent = 0;
  for (let i = 1; i <= window; i += 1) recent += byDate.get(isoDay(todayMs - i * DAY)) ?? 0;
  const dailyAverage = recent / window;

  // Weekday shape from up to eight weeks, only with four or more.
  const weeks = Math.min(8, Math.floor(spanDays / 7));
  const factors = Array(7).fill(1);
  if (weeks >= 4) {
    const totals = Array(7).fill(0);
    for (let i = 1; i <= weeks * 7; i += 1) {
      const ms = todayMs - i * DAY;
      totals[new Date(ms).getUTCDay()] += byDate.get(isoDay(ms)) ?? 0;
    }
    const mean = totals.reduce((a, b) => a + b, 0) / 7;
    if (mean > 0) for (let d = 0; d < 7; d += 1) factors[d] = totals[d] / mean;
  }

  const days = [];
  for (let i = 0; i < horizonDays; i += 1) {
    const ms = todayMs + i * DAY;
    days.push({ date: isoDay(ms), units: round2(dailyAverage * factors[new Date(ms).getUTCDay()]) });
  }
  const confidence = spanDays >= 56 && salesDays >= 20 ? 'high' : spanDays >= 28 && salesDays >= 8 ? 'medium' : 'low';
  return {
    confidence,
    reason: `Average of the last ${window} days${weeks >= 4 ? `, shaped by weekday over ${weeks} weeks` : ''}; sold on ${salesDays} of the last 56 days.`,
    dailyAverage: round2(dailyAverage),
    forecastUnits: Math.round(days.reduce((sum, d) => sum + d.units, 0)),
    weekdayFactors: weeks >= 4 ? factors.map(round2) : null,
    days,
  };
}

/**
 * Stock health for one item (roadmap Phase D "Inventory intelligence"):
 * days of cover at the forecast rate, and what that means.
 */
export function stockHealth({ available, dailyRate, leadDays = 7, overstockDays = 90, soldLast30 = 0 }) {
  if (dailyRate === null || dailyRate === undefined) {
    if (available > 0 && soldLast30 === 0) return { status: 'slow', daysOfCover: null, note: 'No sales in 30 days with stock on the shelf.' };
    return { status: 'unknown', daysOfCover: null, note: 'Not enough sales history to judge.' };
  }
  if (dailyRate <= 0) {
    return available > 0
      ? { status: 'slow', daysOfCover: null, note: 'Nothing sold recently.' }
      : { status: 'unknown', daysOfCover: null, note: 'No stock and no recent sales.' };
  }
  const daysOfCover = round1(Math.max(available, 0) / dailyRate);
  if (available <= 0) return { status: 'stockout', daysOfCover: 0, note: 'Out of stock while it is selling.' };
  if (daysOfCover < leadDays) return { status: 'at_risk', daysOfCover, note: `Runs out in about ${daysOfCover} days — sooner than a ${leadDays}-day restock.` };
  if (daysOfCover > overstockDays) return { status: 'overstock', daysOfCover, note: `More than ${overstockDays} days of stock at the current rate.` };
  return { status: 'healthy', daysOfCover, note: `About ${daysOfCover} days of stock.` };
}

// ── Privacy for cross-store figures ─────────────────────────────────────────

export const MIN_STORES = 5;

/** Median and quartiles, from contributions of at least MIN_STORES distinct stores; else null. */
export function anonymousSpread(contributions, { minStores = MIN_STORES } = {}) {
  const byStore = new Map();
  for (const { storeId, value } of contributions) {
    if (!Number.isFinite(value)) continue;
    if (!byStore.has(storeId)) byStore.set(storeId, []);
    byStore.get(storeId).push(value);
  }
  if (byStore.size < minStores) return null;
  // One value per store (its own median), so a big catalogue cannot dominate.
  const values = [...byStore.values()].map(median).sort((a, b) => a - b);
  return { stores: values.length, p25: Math.round(quantile(values, 0.25)), median: Math.round(quantile(values, 0.5)), p75: Math.round(quantile(values, 0.75)) };
}

// ── Merchant commands (typed or spoken) ─────────────────────────────────────

/**
 * Roadmap Phase D "Voice/text input → proposed structured actions". Each
 * pattern yields an action to CONFIRM; names are resolved by the service.
 */
export function parseMerchantCommand(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  let m;
  if ((m = t.match(/^(?:add|stock in|received?|got)\s+(\d{1,5})\s+(?:units? of |packs? of |of )?(.+?)(?:\s+to (?:the )?stock)?$/))) {
    return { type: 'stock_in', quantity: Number(m[1]), product: m[2] };
  }
  if ((m = t.match(/^(?:remove|stock out|write off|damaged|expired)\s+(\d{1,5})\s+(?:units? of |of )?(.+)$/))) {
    return { type: 'stock_out', quantity: Number(m[1]), product: m[2], reason: /expired/.test(t) ? 'expired' : /damaged/.test(t) ? 'damaged' : 'other' };
  }
  if ((m = t.match(/^(?:set |change |make )?(?:the )?price (?:of )?(.+?) (?:to|=|at) (?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)$/)) || (m = t.match(/^(.+?) (?:price|costs?) (?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)$/))) {
    return { type: 'set_price', product: m[1], pricePaise: Math.round(Number(m[2]) * 100) };
  }
  if ((m = t.match(/^(?:mark |make |set )?(.+?) (?:as )?(?:out of stock|unavailable|not available|hide|hidden)$/)) || (m = t.match(/^hide (.+)$/))) {
    return { type: 'deactivate', product: m[1] };
  }
  if ((m = t.match(/^(?:mark |make |set )?(.+?) (?:as )?(?:available|back in stock|show)$/))) {
    return { type: 'activate', product: m[1] };
  }
  return null;
}

// ── Invoices as text ────────────────────────────────────────────────────────

/**
 * Supplier invoice text (pasted, or read off a PDF's text) → candidate lines
 * (roadmap Phase D "Invoice extraction"). Recognises "name qty x price",
 * "name qty price amount" and "qty name @ price"; header lines give the
 * invoice number and date; a "total" line is checked against the lines.
 */
export function parseInvoiceText(text) {
  const lines = String(text ?? '').slice(0, 20_000).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const result = { invoiceNumber: null, invoiceDate: null, statedTotalPaise: null, lines: [], skipped: [] };
  for (const line of lines.slice(0, 300)) {
    const lower = line.toLowerCase();
    let m;
    if (!result.invoiceNumber && (m = line.match(/\b(?:invoice|inv|bill)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Za-z0-9/-]{2,30})/i)) && /\d/.test(m[1])) {
      result.invoiceNumber = m[1];
      continue;
    }
    if (!result.invoiceDate && (m = line.match(/\b(?:date|dated)\s*[:-]?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i))) {
      const year = m[3].length === 2 ? `20${m[3]}` : m[3];
      result.invoiceDate = `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      continue;
    }
    if (/^(grand\s+)?total\b|^net\s+amount|^amount\s+payable/.test(lower)) {
      const amount = lastNumber(line);
      if (amount !== null) result.statedTotalPaise = Math.round(amount * 100);
      continue;
    }
    const parsed = invoiceLine(line);
    if (parsed) result.lines.push(parsed);
    else if (/[a-z]/i.test(line) && /\d/.test(line)) result.skipped.push(line);
  }
  const computed = result.lines.reduce((sum, l) => sum + l.quantity * l.unitCostPaise, 0);
  result.computedTotalPaise = computed;
  result.totalMatches = result.statedTotalPaise === null ? null : Math.abs(result.statedTotalPaise - computed) <= Math.max(100, result.lines.length * 2);
  return result;
}

function invoiceLine(line) {
  let m;
  // "Basmati Rice 1kg  10 x 95.00" or "Basmati Rice 10 x 95"
  if ((m = line.match(/^(.+?)\s+(\d{1,5})\s*(?:x|×|\*|@)\s*(?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)(?:\s+(?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?))?$/i))) {
    return { name: m[1].trim(), quantity: Number(m[2]), unitCostPaise: Math.round(Number(m[3]) * 100), source: line };
  }
  // "10 Basmati Rice @ 95"
  if ((m = line.match(/^(\d{1,5})\s+(.+?)\s*@\s*(?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)$/i))) {
    return { name: m[2].trim(), quantity: Number(m[1]), unitCostPaise: Math.round(Number(m[3]) * 100), source: line };
  }
  // "Basmati Rice   10   95.00   950.00" — qty, rate, amount (amount checks the rate).
  if ((m = line.match(/^(.+?)\s+(\d{1,5})\s+(\d+(?:\.\d{1,2})?)\s+(\d+(?:\.\d{1,2})?)$/))) {
    const quantity = Number(m[2]);
    const rate = Number(m[3]);
    const amount = Number(m[4]);
    if (Math.abs(quantity * rate - amount) <= 0.05 * amount + 0.5) {
      return { name: m[1].trim(), quantity, unitCostPaise: Math.round(rate * 100), source: line };
    }
  }
  return null;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function lastNumber(text) {
  const all = String(text).replace(/,/g, '').match(/\d+(?:\.\d{1,2})?/g);
  return all ? Number(all[all.length - 1]) : null;
}
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
