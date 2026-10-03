import { supabaseAdmin } from '../../lib/supabase.js';
import { notFound, upstreamFailure } from '../../lib/errors.js';
import { resolveOpenState } from '../../lib/openingHours.js';

/**
 * Storefront reads. Checklist 3.1 – 3.6.
 *
 * Every query is flat and filtered by `store_id`, rather than one nested
 * PostgREST select: a store page is a handful of small indexed lookups, and
 * keeping them separate means the store scope is visible on every call instead
 * of buried in a join string. That scoping is what stops a category or product
 * id from another store being readable through this store's URL.
 *
 * All of these are public (checklist 3.5) — no token required.
 */

export const STORE_COLUMNS = `
  id, slug, name, description, logo_url, cover_image_url, phone, email,
  address_line1, address_line2, city, state, postal_code, country,
  latitude, longitude, opening_hours, timezone,
  pickup_enabled, delivery_enabled, min_order_paise, delivery_fee_paise,
  free_delivery_threshold_paise, accepts_cash, accepts_online,
  is_active, is_published, created_at, updated_at
`;

// price_paise / mrp_paise are the cheapest variant's, kept in step by a
// trigger (migration 0030). Stock lives on the variants (D-5).
const PRODUCT_COLUMNS = `
  id, store_id, category_id, name, slug, description,
  price_paise, mrp_paise, tax_percent, unit, track_inventory, is_available, sort_order
`;

/**
 * Every read in this module goes through here.
 *
 * `upstreamFailure` rather than a bare `internal`: a WAF in front of Supabase can
 * refuse a request outright — a search for `or 1=1--` trips Cloudflare's — and
 * what comes back is an HTML block page rather than JSON. That is a 503 the
 * customer can retry, not a 500 that blames us. A genuine database error still
 * becomes a 500.
 */
const fail = (error, message) => {
  if (error) throw upstreamFailure(error, message);
};

/**
 * Only stores customers may see are reachable: active (the operator's switch)
 * AND published (the merchant's, migration 0025). Anything else is a 404, not
 * a 403 — the same answer as a slug that never existed.
 */
export async function findActiveStoreBySlug(slug) {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select(STORE_COLUMNS)
    .eq('slug', slug)
    .eq('is_active', true)
    .eq('is_published', true)
    .maybeSingle();

  fail(error, 'Could not load the store.');
  if (!data) throw notFound('Store');
  return data;
}

async function isStoreSaved(storeId, customerId) {
  // null rather than false when nobody is signed in, so the frontend can tell
  // "not saved" from "we don't know who you are".
  if (!customerId) return null;

  const { data, error } = await supabaseAdmin
    .from('saved_stores')
    .select('store_id')
    .eq('store_id', storeId)
    .eq('customer_id', customerId)
    .maybeSingle();

  fail(error, 'Could not load your saved stores.');
  return Boolean(data);
}

/**
 * The holidays that can affect open/closed now or in the next fortnight, per
 * store, as YYYY-MM-DD strings (migration 0033). A day of slack on the early
 * side covers a store whose local date is behind UTC's.
 */
export async function holidaysByStore(storeIds, now = new Date()) {
  const byStore = new Map(storeIds.map((id) => [id, []]));
  if (storeIds.length === 0) return byStore;

  const from = new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 16 * 86_400_000).toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from('store_holidays')
    .select('store_id, holiday_date')
    .in('store_id', storeIds)
    .gte('holiday_date', from)
    .lte('holiday_date', to);

  fail(error, 'Could not load the store holidays.');
  for (const row of data ?? []) byStore.get(row.store_id)?.push(row.holiday_date);
  return byStore;
}

/** One store's upcoming holidays — see holidaysByStore. */
export async function holidaysFor(storeId, now = new Date()) {
  return (await holidaysByStore([storeId], now)).get(storeId) ?? [];
}

export function toPublicStore(row, { isSaved = null, now = new Date(), holidays = [] } = {}) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    logoUrl: row.logo_url ?? null,
    coverImageUrl: row.cover_image_url ?? null,
    contact: { phone: row.phone ?? null, email: row.email ?? null },
    location: {
      addressLine1: row.address_line1 ?? null,
      addressLine2: row.address_line2 ?? null,
      city: row.city ?? null,
      state: row.state ?? null,
      postalCode: row.postal_code ?? null,
      country: row.country ?? null,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
    },
    hours: {
      timezone: row.timezone,
      openingHours: row.opening_hours ?? {},
      // Computed server-side so every client agrees on whether it is open.
      ...resolveOpenState(row.opening_hours, row.timezone, now, { holidays }),
    },
    fulfilment: {
      pickupEnabled: row.pickup_enabled,
      deliveryEnabled: row.delivery_enabled,
      minOrderPaise: row.min_order_paise,
      deliveryFeePaise: row.delivery_fee_paise,
      // Delivery is free once the subtotal reaches this; null = never free.
      freeDeliveryThresholdPaise: row.free_delivery_threshold_paise ?? null,
    },
    // What this store takes (migration 0025, set by the merchant). Declared
    // here so the storefront can render it without a second endpoint.
    payment: { online: row.accepts_online, cashOnDelivery: row.accepts_cash },
    isSaved,
  };
}

export const toPublicCategory = (row) => ({
  id: row.id,
  storeId: row.store_id,
  name: row.name,
  slug: row.slug,
  sortOrder: row.sort_order,
});

/**
 * The variant migration 0030 gives a product sold without options (D-6). It
 * is not a choice the customer made, so it is never shown to them: no picker
 * on the product page and no name on a cart or order line.
 */
export const DEFAULT_VARIANT_NAME = 'Default';
export const isDefaultVariant = (variant) => variant?.name === DEFAULT_VARIANT_NAME;

/**
 * What can still be sold of one variant: on hand minus what open orders hold
 * (D-5). null when the product is not counted at all.
 */
export function availableQuantity(product, variant) {
  if (!product.track_inventory) return null;
  return Math.max(0, variant.quantity_on_hand - variant.reserved_quantity);
}

/**
 * A product's stock is the sum over its sellable variants — what the customer
 * could buy in total. `variants` are that product's rows; a product with none
 * sellable is out of stock whether or not it is counted.
 */
export function productStock(product, variants) {
  const sellable = variants.filter((variant) => variant.is_available);
  if (!product.track_inventory) return { stock: null, outOfStock: sellable.length === 0 };

  const stock = sellable.reduce((sum, variant) => sum + availableQuantity(product, variant), 0);
  return { stock, outOfStock: stock <= 0 };
}

export function toPublicProduct(row, imageUrl = null, variants = []) {
  const { stock, outOfStock } = productStock(row, variants);
  return {
    id: row.id,
    storeId: row.store_id,
    categoryId: row.category_id ?? null,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    pricePaise: row.price_paise,
    mrpPaise: row.mrp_paise ?? null,
    // Tax is added on top of pricePaise at checkout (D-4); the product page
    // says "+ GST" when this is above zero.
    taxPercent: Number(row.tax_percent ?? 0),
    unit: row.unit ?? 'pcs',
    isAvailable: row.is_available,
    // What can still be ordered, across variants; null = not counted.
    stock,
    outOfStock,
    // The single flag the storefront should gate "Add to cart" on.
    isPurchasable: row.is_available && !outOfStock,
    imageUrl,
  };
}

/**
 * The shop directory: every store a customer may see — active and published,
 * the same two switches as findActiveStoreBySlug — newest first. Each entry
 * is the public store payload, so a card can say open or closed and how the
 * shop delivers without a request per shop.
 */
export async function listStores({ q, page, limit }, now = new Date()) {
  const from = (page - 1) * limit;

  let query = supabaseAdmin
    .from('stores')
    .select(STORE_COLUMNS, { count: 'exact' })
    .eq('is_active', true)
    .eq('is_published', true);

  if (q) {
    const term = escapeSearchTerm(q);
    query = query.or(`name.ilike.%${term}%,city.ilike.%${term}%`);
  }

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .order('name', { ascending: true })
    .range(from, from + limit - 1);

  fail(error, 'Could not load the shops.');

  const rows = data ?? [];
  const holidays = await holidaysByStore(rows.map((row) => row.id), now);
  return {
    stores: rows.map((row) => toPublicStore(row, { now, holidays: holidays.get(row.id) ?? [] })),
    total: count ?? rows.length,
  };
}

/** Checklist 3.1 + 3.6 */
export async function getStorePage(slug, customerId) {
  const store = await findActiveStoreBySlug(slug);
  const [isSaved, holidays] = await Promise.all([isStoreSaved(store.id, customerId), holidaysFor(store.id)]);
  return toPublicStore(store, { isSaved, holidays });
}

/** Checklist 3.3 */
export async function listCategories(slug) {
  const store = await findActiveStoreBySlug(slug);

  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('id, store_id, name, slug, sort_order')
    .eq('store_id', store.id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  fail(error, 'Could not load the categories.');
  return { store, categories: (data ?? []).map(toPublicCategory) };
}

/** Every variant of these products, grouped by product — for stock on listings. */
async function variantsByProduct(productIds) {
  if (productIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('product_variants')
    .select(VARIANT_COLUMNS)
    .in('product_id', productIds)
    .order('sort_order', { ascending: true });

  fail(error, 'Could not load the product variants.');

  const byProduct = new Map();
  for (const variant of data ?? []) {
    if (!byProduct.has(variant.product_id)) byProduct.set(variant.product_id, []);
    byProduct.get(variant.product_id).push(variant);
  }
  return byProduct;
}

/** Primary image per product, for the listing thumbnails. */
async function primaryImages(productIds) {
  if (productIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('product_images')
    .select('product_id, url, sort_order')
    .in('product_id', productIds)
    .order('sort_order', { ascending: true });

  fail(error, 'Could not load the product images.');

  const byProduct = new Map();
  for (const image of data ?? []) {
    // Ordered by sort_order, so the first one seen wins.
    if (!byProduct.has(image.product_id)) byProduct.set(image.product_id, image.url);
  }
  return byProduct;
}

/**
 * Checklist 3.4. A categoryId from another store is a 404 rather than an empty
 * list, so a guessed id cannot be used to probe which categories exist.
 */
export async function listProducts(slug, { categoryId, page, limit, availableOnly }) {
  const store = await findActiveStoreBySlug(slug);

  if (categoryId) await findStoreCategory(store.id, categoryId);

  let query = supabaseAdmin
    .from('products')
    .select(PRODUCT_COLUMNS, { count: 'exact' })
    .eq('store_id', store.id)
    .is('archived_at', null);

  if (categoryId) query = query.eq('category_id', categoryId);
  if (availableOnly) query = query.eq('is_available', true);

  const from = (page - 1) * limit;
  const { data, count, error } = await query
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .range(from, from + limit - 1);

  fail(error, 'Could not load the products.');

  const rows = data ?? [];
  const ids = rows.map((row) => row.id);
  const [images, variants] = await Promise.all([primaryImages(ids), variantsByProduct(ids)]);

  return {
    store,
    products: rows.map((row) =>
      toPublicProduct(row, images.get(row.id) ?? null, variants.get(row.id) ?? []),
    ),
    total: count ?? rows.length,
  };
}

// ── Phase 4: product detail and store-scoped search ─────────────────────────

// Never cost_paise: what the merchant paid is not the customer's business
// (MERCHANT_RULES P-11).
const VARIANT_COLUMNS = `
  id, product_id, name, sku, price_paise, mrp_paise,
  quantity_on_hand, reserved_quantity, is_available, sort_order
`;

export function toPublicVariant(row, product) {
  const stock = availableQuantity(product, row);
  const outOfStock = stock !== null && stock <= 0;
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    // Absolute, never a delta (decision D15) — the order snapshot copies it.
    pricePaise: row.price_paise,
    mrpPaise: row.mrp_paise ?? null,
    // Available (on hand − reserved), never on hand: customer API change 3.
    stock,
    isAvailable: row.is_available,
    outOfStock,
    isPurchasable: row.is_available && !outOfStock,
  };
}

export const toPublicImage = (row) => ({
  id: row.id,
  url: row.url,
  altText: row.alt_text ?? null,
  sortOrder: row.sort_order,
});

/**
 * Checklist 4.1 + 4.5. The product is fetched with BOTH the id and the store id
 * in the filter, so a product id belonging to another store is a 404 here
 * rather than a readable payload under this store's URL (decision D22).
 */
export async function getProductDetail(slug, productId) {
  const store = await findActiveStoreBySlug(slug);
  const product = await findStoreProduct(store.id, productId);

  const [images, variantRows] = await Promise.all([
    listProductImages(product.id),
    listVariantRows(product.id),
  ]);

  return {
    store,
    product: {
      ...toPublicProduct(product, images[0]?.url ?? null, variantRows),
      images,
      // A product sold without options has only its Default variant, which is
      // left out: the page shows no picker and the cart fills it in
      // (cart.service resolveVariant). Real options, even a single one, show —
      // and once a merchant adds options to a simple product, its Default
      // shows with them, or it could never be chosen.
      variants:
        variantRows.length === 1 && isDefaultVariant(variantRows[0])
          ? []
          : variantRows.map((row) => toPublicVariant(row, product)),
    },
  };
}

/** Shared by the detail endpoint and by every write path that takes a productId. */
export async function findStoreProduct(storeId, productId) {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('id', productId)
    .eq('store_id', storeId)
    .is('archived_at', null)
    .maybeSingle();

  fail(error, 'Could not load the product.');
  if (!data) throw notFound('Product');
  return data;
}

export async function listProductImages(productId) {
  const { data, error } = await supabaseAdmin
    .from('product_images')
    .select('id, product_id, url, alt_text, sort_order')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true });

  fail(error, 'Could not load the product images.');
  return (data ?? []).map(toPublicImage);
}

/** Raw variant rows of one product, in display order. */
export async function listVariantRows(productId) {
  const { data, error } = await supabaseAdmin
    .from('product_variants')
    .select(VARIANT_COLUMNS)
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  fail(error, 'Could not load the product variants.');
  return data ?? [];
}

/**
 * Checklist 4.3. PostgREST reads the `or=` filter as its own little grammar:
 * a comma starts the next condition and a parenthesis closes the group, so a
 * raw query string could otherwise smuggle in a second filter. Escaping those
 * characters — plus the LIKE wildcards, which would make `%` match everything —
 * keeps the customer's text as literal text.
 */
export function escapeSearchTerm(term) {
  return term.replace(/[%_\\]/g, (char) => `\\${char}`).replace(/[,().*"]/g, ' ');
}

/**
 * Checklist 4.2. Store-scoped by construction: the `store_id` filter is applied
 * before the text match, so search can never reach across stores. Matches on
 * name and description only (4.2), case-insensitively.
 */
export async function searchProducts(slug, { q, categoryId, page, limit }) {
  const store = await findActiveStoreBySlug(slug);

  if (categoryId) await findStoreCategory(store.id, categoryId);

  const term = escapeSearchTerm(q);
  const from = (page - 1) * limit;

  let query = supabaseAdmin
    .from('products')
    .select(PRODUCT_COLUMNS, { count: 'exact' })
    .eq('store_id', store.id)
    .is('archived_at', null);

  if (categoryId) query = query.eq('category_id', categoryId);

  const { data, count, error } = await query
    .or(`name.ilike.%${term}%,description.ilike.%${term}%`)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .range(from, from + limit - 1);

  fail(error, 'Could not run the search.');

  const rows = data ?? [];
  const ids = rows.map((row) => row.id);
  const [images, variants] = await Promise.all([primaryImages(ids), variantsByProduct(ids)]);

  return {
    store,
    query: q,
    // Checklist 4.4: an unavailable match is still returned, flagged by
    // toPublicProduct's isPurchasable rather than hidden.
    products: rows.map((row) =>
      toPublicProduct(row, images.get(row.id) ?? null, variants.get(row.id) ?? []),
    ),
    total: count ?? rows.length,
  };
}

/** A category id from another store is a 404, not an empty list (decision D23). */
export async function findStoreCategory(storeId, categoryId) {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('id, store_id, name, slug, sort_order')
    .eq('id', categoryId)
    .eq('store_id', storeId)
    .maybeSingle();

  fail(error, 'Could not load the category.');
  if (!data) throw notFound('Category');
  return data;
}

/**
 * By id rather than slug, for the customer-side flows (cart, checkout, orders)
 * where the store is already known. Inactive and unpublished stores stay
 * unreachable: a store that is not trading must not accept new orders.
 */
export async function findActiveStoreById(storeId) {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select(STORE_COLUMNS)
    .eq('id', storeId)
    .eq('is_active', true)
    .eq('is_published', true)
    .maybeSingle();

  fail(error, 'Could not load the store.');
  if (!data) throw notFound('Store');
  return data;
}

/** One variant of one product. A variant id from another product is a 404. */
export async function findProductVariant(productId, variantId) {
  const { data, error } = await supabaseAdmin
    .from('product_variants')
    .select(VARIANT_COLUMNS)
    .eq('id', variantId)
    .eq('product_id', productId)
    .maybeSingle();

  fail(error, 'Could not load the product variant.');
  if (!data) throw notFound('Product variant');
  return data;
}
