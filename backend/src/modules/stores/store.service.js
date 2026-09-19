import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, notFound } from '../../lib/errors.js';
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

const STORE_COLUMNS = `
  id, slug, name, description, logo_url, cover_image_url, phone, email,
  address_line1, address_line2, city, state, postal_code, country,
  latitude, longitude, opening_hours, timezone,
  pickup_enabled, delivery_enabled, min_order_paise, delivery_fee_paise,
  is_active, created_at, updated_at
`;

const PRODUCT_COLUMNS = `
  id, store_id, category_id, name, slug, description,
  price_paise, mrp_paise, is_available, stock, sort_order
`;

const fail = (error, message) => {
  if (error) throw internal(message);
};

/** Only active stores are reachable: an inactive one is a 404, not a 403. */
export async function findActiveStoreBySlug(slug) {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select(STORE_COLUMNS)
    .eq('slug', slug)
    .eq('is_active', true)
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

export function toPublicStore(row, { isSaved = null, now = new Date() } = {}) {
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
      ...resolveOpenState(row.opening_hours, row.timezone, now),
    },
    fulfilment: {
      pickupEnabled: row.pickup_enabled,
      deliveryEnabled: row.delivery_enabled,
      minOrderPaise: row.min_order_paise,
      deliveryFeePaise: row.delivery_fee_paise,
    },
    // Payment options are the same everywhere for now: the mock provider (D7)
    // plus cash on pickup/delivery. Declared here so the storefront can render
    // it without a second endpoint.
    payment: { online: true, cashOnDelivery: true },
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

export function toPublicProduct(row, imageUrl = null) {
  const outOfStock = row.stock !== null && row.stock <= 0;
  return {
    id: row.id,
    storeId: row.store_id,
    categoryId: row.category_id ?? null,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    pricePaise: row.price_paise,
    mrpPaise: row.mrp_paise ?? null,
    isAvailable: row.is_available,
    // stock null means the store does not count this item (migration 0006).
    stock: row.stock ?? null,
    outOfStock,
    // The single flag the storefront should gate "Add to cart" on.
    isPurchasable: row.is_available && !outOfStock,
    imageUrl,
  };
}

/** Checklist 3.1 + 3.6 */
export async function getStorePage(slug, customerId) {
  const store = await findActiveStoreBySlug(slug);
  return toPublicStore(store, { isSaved: await isStoreSaved(store.id, customerId) });
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
    .eq('store_id', store.id);

  if (categoryId) query = query.eq('category_id', categoryId);
  if (availableOnly) query = query.eq('is_available', true);

  const from = (page - 1) * limit;
  const { data, count, error } = await query
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .range(from, from + limit - 1);

  fail(error, 'Could not load the products.');

  const rows = data ?? [];
  const images = await primaryImages(rows.map((row) => row.id));

  return {
    store,
    products: rows.map((row) => toPublicProduct(row, images.get(row.id) ?? null)),
    total: count ?? rows.length,
  };
}

// ── Phase 4: product detail and store-scoped search ─────────────────────────

const VARIANT_COLUMNS = 'id, product_id, name, price_paise, stock, is_available, sort_order';

export function toPublicVariant(row) {
  const outOfStock = row.stock !== null && row.stock <= 0;
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    // Absolute, never a delta (decision D15) — the order snapshot copies it.
    pricePaise: row.price_paise,
    stock: row.stock ?? null,
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

  const [images, variants] = await Promise.all([
    listProductImages(product.id),
    listProductVariants(product.id),
  ]);

  return {
    store,
    product: {
      ...toPublicProduct(product, images[0]?.url ?? null),
      images,
      variants,
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

export async function listProductVariants(productId) {
  const { data, error } = await supabaseAdmin
    .from('product_variants')
    .select(VARIANT_COLUMNS)
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  fail(error, 'Could not load the product variants.');
  return (data ?? []).map(toPublicVariant);
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
    .eq('store_id', store.id);

  if (categoryId) query = query.eq('category_id', categoryId);

  const { data, count, error } = await query
    .or(`name.ilike.%${term}%,description.ilike.%${term}%`)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .range(from, from + limit - 1);

  fail(error, 'Could not run the search.');

  const rows = data ?? [];
  const images = await primaryImages(rows.map((row) => row.id));

  return {
    store,
    query: q,
    // Checklist 4.4: an unavailable match is still returned, flagged by
    // toPublicProduct's isPurchasable rather than hidden.
    products: rows.map((row) => toPublicProduct(row, images.get(row.id) ?? null)),
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
 * where the store is already known. Inactive stores stay unreachable: a store
 * that stops trading must not accept new orders.
 */
export async function findActiveStoreById(storeId) {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select(STORE_COLUMNS)
    .eq('id', storeId)
    .eq('is_active', true)
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
