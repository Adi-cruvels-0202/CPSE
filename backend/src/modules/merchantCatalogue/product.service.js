import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '../../lib/supabase.js';
import { conflict, internal, notFound, skuTaken, unprocessable, validationFailed } from '../../lib/errors.js';
import { slugify, firstFreeSlug } from '../../lib/slug.js';
import { logger } from '../../lib/logger.js';
import { findStoreCategory } from './category.service.js';
import { MAX_PRODUCT_IMAGES } from './catalogue.schemas.js';
import { storeImage, removeStoredImage } from '../../lib/imageUpload.js';

/**
 * A store's products and variants — MERCHANT_API.md, Products and variants;
 * MERCHANT_RULES §4. `store` is the caller's own store (requireStoreOwner).
 *
 * Price, MRP, cost, SKU and stock live on the variant (D-6). Stock is never
 * set here, apart from opening stock on a new variant, which is logged as a
 * stock_in like any other — every other movement goes through Inventory.
 *
 * Creating a product, adding variants and replacing images are SQL functions
 * (migration 0031), so each commits whole or not at all.
 */

const PRODUCT_COLUMNS = `
  id, store_id, category_id, name, slug, description, price_paise, mrp_paise,
  tax_percent, unit, track_inventory, low_stock_threshold, is_available,
  sort_order, created_at, updated_at
`;
const VARIANT_COLUMNS = `
  id, product_id, name, sku, barcode, weight_grams, price_paise, mrp_paise,
  cost_paise, quantity_on_hand, reserved_quantity, is_available, sort_order
`;
const UNIQUE_VIOLATION = '23505';

// ── Shapes ───────────────────────────────────────────────────────────────────

/** Low = what can still be sold is at or under the product's threshold (P-7). */
function isLowStock(product, variant) {
  if (!product.track_inventory || product.low_stock_threshold == null) return false;
  return variant.quantity_on_hand - variant.reserved_quantity <= product.low_stock_threshold;
}

function toMerchantVariant(product, row) {
  const tracked = product.track_inventory;
  return {
    id: row.id,
    name: row.name,
    sku: row.sku ?? null,
    barcode: row.barcode ?? null,
    weightGrams: row.weight_grams ?? null,
    pricePaise: row.price_paise,
    mrpPaise: row.mrp_paise ?? null,
    costPaise: row.cost_paise ?? null,
    isActive: row.is_available,
    sortOrder: row.sort_order,
    quantityOnHand: tracked ? row.quantity_on_hand : null,
    reservedQuantity: tracked ? row.reserved_quantity : null,
    availableQuantity: tracked ? row.quantity_on_hand - row.reserved_quantity : null,
    isLowStock: isLowStock(product, row),
  };
}

export function toMerchantProduct(row, { variants = [], images = [], categoryName = null } = {}) {
  const sorted = [...variants].sort((a, b) => a.sort_order - b.sort_order);
  const active = sorted.filter((variant) => variant.is_available);
  const sum = (key) => active.reduce((total, variant) => total + variant[key], 0);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    categoryId: row.category_id ?? null,
    categoryName,
    unit: row.unit,
    taxPercent: Number(row.tax_percent ?? 0),
    trackInventory: row.track_inventory,
    lowStockThreshold: row.low_stock_threshold ?? null,
    isActive: row.is_available,
    // The cheapest variant's, kept in step by a trigger (migration 0030) —
    // what the customer's product card shows.
    pricePaise: row.price_paise,
    images: [...images]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((image) => ({ id: image.id, url: image.url, altText: image.alt_text ?? null, sortOrder: image.sort_order })),
    variants: sorted.map((variant) => toMerchantVariant(row, variant)),
    // Across active variants; null when the product is not counted.
    stock: row.track_inventory
      ? {
          quantityOnHand: sum('quantity_on_hand'),
          reservedQuantity: sum('reserved_quantity'),
          availableQuantity: sum('quantity_on_hand') - sum('reserved_quantity'),
        }
      : null,
    isLowStock: sorted.some((variant) => variant.is_available && isLowStock(row, variant)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function childrenOf(productIds) {
  if (productIds.length === 0) return { variants: new Map(), images: new Map() };

  const [variants, images] = await Promise.all([
    supabaseAdmin.from('product_variants').select(VARIANT_COLUMNS).in('product_id', productIds),
    supabaseAdmin.from('product_images').select('id, product_id, url, alt_text, sort_order').in('product_id', productIds),
  ]);
  if (variants.error || images.error) throw internal('Could not load the products.');

  const group = (rows) => {
    const byProduct = new Map();
    for (const row of rows ?? []) {
      if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, []);
      byProduct.get(row.product_id).push(row);
    }
    return byProduct;
  };
  return { variants: group(variants.data), images: group(images.data) };
}

async function categoryNames(storeId) {
  const { data, error } = await supabaseAdmin.from('categories').select('id, name').eq('store_id', storeId);
  if (error) throw internal('Could not load the categories.');
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

async function shapeAll(store, rows) {
  const [children, names] = await Promise.all([childrenOf(rows.map((row) => row.id)), categoryNames(store.id)]);
  return rows.map((row) =>
    toMerchantProduct(row, {
      variants: children.variants.get(row.id) ?? [],
      images: children.images.get(row.id) ?? [],
      categoryName: row.category_id ? names.get(row.category_id) ?? null : null,
    }),
  );
}

/** A product of this store, or 404 — another store's id is no different from none. */
async function findStoreProductRow(store, productId) {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('id', productId)
    .eq('store_id', store.id)
    .maybeSingle();

  if (error) throw internal('Could not load the product.');
  if (!data) throw notFound('Product');
  return data;
}

/** `GET …/products/:productId` */
export async function getProduct(store, productId) {
  const [product] = await shapeAll(store, [await findStoreProductRow(store, productId)]);
  return product;
}

/**
 * `GET …/products`. Low stock is computed from the variants, so the filters
 * run over the store's whole catalogue and the page is cut afterwards — a
 * shop's catalogue is hundreds of rows, not millions.
 */
export async function listProducts(store, { search, categoryId, isActive, lowStock, page, limit }) {
  if (categoryId) await findStoreCategory(store, categoryId);

  let query = supabaseAdmin.from('products').select(PRODUCT_COLUMNS).eq('store_id', store.id);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (isActive !== undefined) query = query.eq('is_available', isActive);
  if (search) {
    const term = search.replace(/[%_\\]/g, (char) => `\\${char}`);
    query = query.ilike('name', `%${term}%`);
  }

  const { data, error } = await query.order('sort_order', { ascending: true }).order('name', { ascending: true });
  if (error) throw internal('Could not load the products.');

  let products = await shapeAll(store, data ?? []);
  if (lowStock !== undefined) products = products.filter((product) => product.isLowStock === lowStock);

  const from = (page - 1) * limit;
  return { products: products.slice(from, from + limit), total: products.length };
}

// ── SKUs ─────────────────────────────────────────────────────────────────────

/** MERCHANT_RULES P-5: SKU-<up to 8 letters of the name>-<6 random>. */
export function generateSku(productName, variantName) {
  const letters = `${productName}${variantName === 'Default' ? '' : variantName}`
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8);
  return `SKU-${letters || 'ITEM'}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

/** Refuses any of these SKUs the store already uses (case-insensitive, like the index). */
async function assertSkusFree(store, skus, exceptVariantId = null) {
  if (skus.length === 0) return;

  const { data, error } = await supabaseAdmin
    .from('product_variants')
    .select('id, sku')
    .eq('store_id', store.id);
  if (error) throw internal('Could not check the SKUs.');

  const used = new Map(
    (data ?? []).filter((row) => row.sku && row.id !== exceptVariantId).map((row) => [row.sku.toLowerCase(), row.sku]),
  );
  const clash = skus.find((sku) => used.has(sku.toLowerCase()));
  if (clash) throw skuTaken(clash);
}

/** Request variant → the SQL functions' payload, with a SKU filled in. */
const toVariantPayload = (productName) => (variant) => ({
  name: variant.name,
  sku: variant.sku ?? generateSku(productName, variant.name),
  barcode: variant.barcode ?? null,
  weight_grams: variant.weightGrams ?? null,
  price_paise: variant.pricePaise,
  mrp_paise: variant.mrpPaise ?? null,
  cost_paise: variant.costPaise ?? null,
  opening_quantity: variant.openingQuantity ?? 0,
});

/**
 * Turns a database refusal into the 409 the merchant can act on. Anything not
 * recognised is a genuine failure, logged and answered as one.
 */
function translateWriteError(error, fallback) {
  const message = error?.message ?? '';
  if (error?.code === UNIQUE_VIOLATION && message.includes('product_variants_store_sku_key')) {
    // Lost a race with another save after the up-front check.
    return skuTaken();
  }
  if (error?.code === UNIQUE_VIOLATION && message.includes('product_variants_product_name_key')) {
    return conflict('This product already has a variant with that name.');
  }
  logger.error(fallback, { code: error?.code, message });
  return internal(fallback);
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** `POST …/products` — product, variants, opening stock and images in one go. */
export async function createProduct(store, merchant, input) {
  if (input.categoryId) await findStoreCategory(store, input.categoryId);

  const variants = input.variants.map(toVariantPayload(input.name));
  await assertSkusFree(store, variants.map((variant) => variant.sku));

  const slugTaken = async (candidate) => {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('id')
      .eq('store_id', store.id)
      .eq('slug', candidate)
      .maybeSingle();
    if (error) throw internal('Could not check the product link.');
    return Boolean(data);
  };

  // A product created at the same instant can take the generated slug; that
  // one is simply regenerated.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = await firstFreeSlug(slugify(input.name, 'product'), slugTaken);
    const { data, error } = await supabaseAdmin.rpc('create_product', {
      payload: {
        store_id: store.id,
        merchant_id: merchant.id,
        name: input.name,
        slug,
        description: input.description ?? null,
        category_id: input.categoryId ?? null,
        unit: input.unit,
        tax_percent: input.taxPercent,
        track_inventory: input.trackInventory,
        low_stock_threshold: input.lowStockThreshold ?? null,
        images: input.images.map((image) => ({ url: image.url, alt_text: image.altText ?? null })),
        variants,
      },
    });

    if (!error) return getProduct(store, Array.isArray(data) ? data[0] : data);
    if (!(error.code === UNIQUE_VIOLATION && (error.message ?? '').includes('products_store_slug_key'))) {
      throw translateWriteError(error, 'Could not create the product.');
    }
  }
  throw internal('Could not create the product.');
}

/**
 * `PATCH …/products/:productId`. The slug stays — it is in customer links.
 * `images` replaces the list, through its own transaction.
 */
export async function updateProduct(store, productId, input) {
  await findStoreProductRow(store, productId);
  if (input.categoryId) await findStoreCategory(store, input.categoryId);

  const patch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.categoryId !== undefined) patch.category_id = input.categoryId;
  if (input.unit !== undefined) patch.unit = input.unit;
  if (input.taxPercent !== undefined) patch.tax_percent = input.taxPercent;
  if (input.trackInventory !== undefined) patch.track_inventory = input.trackInventory;
  if (input.lowStockThreshold !== undefined) patch.low_stock_threshold = input.lowStockThreshold;

  if (Object.keys(patch).length > 0) {
    const { error } = await supabaseAdmin.from('products').update(patch).eq('id', productId).eq('store_id', store.id);
    if (error) throw translateWriteError(error, 'Could not update the product.');
  }

  if (input.images !== undefined) {
    const { error } = await supabaseAdmin.rpc('replace_product_images', {
      payload: {
        product_id: productId,
        images: input.images.map((image) => ({ url: image.url, alt_text: image.altText ?? null })),
      },
    });
    if (error) throw translateWriteError(error, 'Could not save the images.');
  }

  return getProduct(store, productId);
}

/** `POST …/activate` and `…/deactivate`. Inactive products stay listed, unavailable (P-8). */
export async function setProductActive(store, productId, isActive) {
  await findStoreProductRow(store, productId);
  const { error } = await supabaseAdmin
    .from('products')
    .update({ is_available: isActive })
    .eq('id', productId)
    .eq('store_id', store.id);
  if (error) throw internal('Could not update the product.');
  return getProduct(store, productId);
}

async function productVariants(productId) {
  const { data, error } = await supabaseAdmin.from('product_variants').select(VARIANT_COLUMNS).eq('product_id', productId);
  if (error) throw internal('Could not load the variants.');
  return data ?? [];
}

function assertVariantNameFree(variants, name, exceptId = null) {
  const wanted = name.toLowerCase();
  if (variants.some((row) => row.id !== exceptId && row.name.toLowerCase() === wanted)) {
    throw conflict('This product already has a variant with that name.');
  }
}

/** `POST …/products/:productId/variants` — one variant, with any opening stock. */
export async function addVariant(store, merchant, productId, input) {
  const product = await findStoreProductRow(store, productId);
  assertVariantNameFree(await productVariants(productId), input.name);
  if (input.openingQuantity > 0 && !product.track_inventory) {
    throw validationFailed({
      issues: [{ source: 'body', field: 'openingQuantity', message: 'Opening stock needs stock tracking on.' }],
    });
  }

  const variant = toVariantPayload(product.name)(input);
  await assertSkusFree(store, [variant.sku]);

  const { error } = await supabaseAdmin.rpc('add_product_variants', {
    payload: { store_id: store.id, product_id: productId, merchant_id: merchant.id, variants: [variant] },
  });
  if (error) throw translateWriteError(error, 'Could not add the variant.');

  return getProduct(store, productId);
}

async function findProductVariant(productId, variantId) {
  const { data, error } = await supabaseAdmin
    .from('product_variants')
    .select(VARIANT_COLUMNS)
    .eq('id', variantId)
    .eq('product_id', productId)
    .maybeSingle();
  if (error) throw internal('Could not load the variant.');
  if (!data) throw notFound('Product variant');
  return data;
}

/** `PATCH …/variants/:variantId`. Stock is not here — it moves through Inventory. */
export async function updateVariant(store, productId, variantId, input) {
  await findStoreProductRow(store, productId);
  const current = await findProductVariant(productId, variantId);

  // The MRP rule spans two fields; check it against what the row will hold.
  const price = input.pricePaise ?? current.price_paise;
  const mrp = input.mrpPaise !== undefined ? input.mrpPaise : current.mrp_paise;
  if (mrp != null && mrp < price) {
    throw validationFailed({
      issues: [{ source: 'body', field: 'mrpPaise', message: 'The MRP cannot be below the price.' }],
    });
  }
  if (input.name !== undefined) assertVariantNameFree(await productVariants(productId), input.name, variantId);
  if (input.sku !== undefined) await assertSkusFree(store, [input.sku], variantId);

  const patch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.sku !== undefined) patch.sku = input.sku;
  if (input.barcode !== undefined) patch.barcode = input.barcode;
  if (input.weightGrams !== undefined) patch.weight_grams = input.weightGrams;
  if (input.pricePaise !== undefined) patch.price_paise = input.pricePaise;
  if (input.mrpPaise !== undefined) patch.mrp_paise = input.mrpPaise;
  if (input.costPaise !== undefined) patch.cost_paise = input.costPaise;

  const { error } = await supabaseAdmin.from('product_variants').update(patch).eq('id', variantId);
  if (error) throw translateWriteError(error, 'Could not update the variant.');

  return getProduct(store, productId);
}

/** `POST …/variants/:variantId/activate` and `…/deactivate`. */
export async function setVariantActive(store, productId, variantId, isActive) {
  await findStoreProductRow(store, productId);
  await findProductVariant(productId, variantId);

  const { error } = await supabaseAdmin.from('product_variants').update({ is_available: isActive }).eq('id', variantId);
  if (error) throw internal('Could not update the variant.');
  return getProduct(store, productId);
}

// ── Photos (P1, D-10) ────────────────────────────────────────────────────────

async function productImages(productId) {
  const { data, error } = await supabaseAdmin
    .from('product_images')
    .select('id, product_id, url, sort_order')
    .eq('product_id', productId);
  if (error) throw internal('Could not load the photos.');
  return data ?? [];
}

/** `POST …/products/:productId/images` — added after the existing photos. */
export async function addProductImage(store, productId, file) {
  await findStoreProductRow(store, productId);
  const existing = await productImages(productId);
  if (existing.length >= MAX_PRODUCT_IMAGES) {
    throw unprocessable('IMAGE_LIMIT', `A product can have at most ${MAX_PRODUCT_IMAGES} photos. Remove one first.`);
  }

  const url = await storeImage(file, `stores/${store.id}/products/${productId}`);
  const sortOrder = existing.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;

  const { error } = await supabaseAdmin
    .from('product_images')
    .insert({ product_id: productId, url, sort_order: sortOrder });
  if (error) {
    await removeStoredImage(url);
    throw internal('Could not save the photo.');
  }

  return getProduct(store, productId);
}

/**
 * `DELETE …/products/:productId/images/:imageId`. Looked up by product AND
 * image, so a photo id from another product is a 404 — Merchant-One checked the
 * product and then deleted any image id it was given (MERCHANT_RULES S-18).
 */
export async function removeProductImage(store, productId, imageId) {
  await findStoreProductRow(store, productId);

  const { data, error } = await supabaseAdmin
    .from('product_images')
    .delete()
    .eq('id', imageId)
    .eq('product_id', productId)
    .select('id, url')
    .maybeSingle();

  if (error) throw internal('Could not remove the photo.');
  if (!data) throw notFound('Photo');

  await removeStoredImage(data.url);
  return getProduct(store, productId);
}
