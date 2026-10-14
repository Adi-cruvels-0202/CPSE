import { supabaseAdmin } from '../../lib/supabase.js';
import { conflict, internal, notFound, unprocessable } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { INDUSTRY_TEMPLATES } from '../../lib/industryTemplates.js';
import { createCategory, listCategories } from './category.service.js';
import { createProduct, getProduct, generateSku } from './product.service.js';

/**
 * Catalogue operations that save the merchant repeated work — roadmap §4 P1:
 * industry templates, starter catalogues, workflow defaults, category
 * remove/reorder, duplicate/reuse and barcode lookup. Everything here goes
 * through the same create/update paths a hand-made product does, so the same
 * validation, SKU rules and ledger entries apply.
 */

const fail = (error, message) => {
  if (error) throw internal(message);
};

// ── Workflow defaults ───────────────────────────────────────────────────────

export const toDefaults = (store) => ({
  lowStockThreshold: store.default_low_stock_threshold ?? null,
  taxPercent: Number(store.default_tax_percent ?? 0),
  trackInventory: store.default_track_inventory ?? true,
  expiryAlertDays: store.expiry_alert_days ?? 30,
  templateApplied: store.template_applied ?? null,
  templateAppliedAt: store.template_applied_at ?? null,
});

export async function updateDefaults(store, input) {
  const patch = {};
  if (input.lowStockThreshold !== undefined) patch.default_low_stock_threshold = input.lowStockThreshold;
  if (input.taxPercent !== undefined) patch.default_tax_percent = input.taxPercent;
  if (input.trackInventory !== undefined) patch.default_track_inventory = input.trackInventory;
  if (input.expiryAlertDays !== undefined) patch.expiry_alert_days = input.expiryAlertDays;
  const { data, error } = await supabaseAdmin.from('stores').update(patch).eq('id', store.id).select('*').maybeSingle();
  fail(error, 'Could not save the defaults.');
  return toDefaults(data);
}

// ── Templates ───────────────────────────────────────────────────────────────

export function getTemplate(industry) {
  const template = INDUSTRY_TEMPLATES[industry];
  if (!template) throw notFound('Template');
  return {
    industry,
    label: template.label,
    defaults: template.defaults,
    categories: template.categories,
    products: template.products.map((product) => ({
      key: product.key,
      name: product.name,
      category: product.category,
      unit: product.unit,
      taxPercent: product.taxPercent,
      variants: product.variants.map((variant) => ({
        name: variant.name,
        suggestedPricePaise: variant.pricePaise,
        weightGrams: variant.weightGrams ?? null,
      })),
    })),
  };
}

/**
 * Applies a template to a store: its categories, the chosen starter products
 * (with the merchant's own prices where given), and — if asked — its workflow
 * defaults. Safe to repeat: a category or product the store already has (by
 * name, ignoring case) is skipped, never overwritten. Each product is created
 * on its own, so one refusal is reported without undoing the rest.
 */
export async function applyTemplate(store, merchant, input) {
  const template = INDUSTRY_TEMPLATES[input.industry];
  if (!template) throw notFound('Template');

  const report = { categoriesCreated: [], categoriesSkipped: [], productsCreated: [], productsSkipped: [], failed: [] };

  if (input.applyDefaults) {
    const { error } = await supabaseAdmin
      .from('stores')
      .update({
        shop_category: template.shopCategory,
        default_low_stock_threshold: template.defaults.lowStockThreshold,
        default_tax_percent: template.defaults.taxPercent,
        default_track_inventory: template.defaults.trackInventory,
        expiry_alert_days: template.defaults.expiryAlertDays,
      })
      .eq('id', store.id);
    fail(error, 'Could not apply the defaults.');
  }

  const wantedProducts = input.products === 'all'
    ? template.products.map((p) => ({ key: p.key }))
    : input.products;
  const byKey = new Map(template.products.map((p) => [p.key, p]));
  for (const choice of wantedProducts) {
    if (!byKey.has(choice.key)) throw unprocessable('UNKNOWN_TEMPLATE_PRODUCT', `"${choice.key}" is not in this template.`);
  }

  // Categories: the template's, or only those the chosen products need.
  const neededCategories = new Set(
    input.categories === 'all'
      ? template.categories
      : [...(input.categories ?? []), ...wantedProducts.map((c) => byKey.get(c.key).category)],
  );
  const existing = await listCategories(store);
  const categoryIdByName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));
  for (const name of template.categories.filter((n) => neededCategories.has(n))) {
    if (categoryIdByName.has(name.toLowerCase())) {
      report.categoriesSkipped.push(name);
      continue;
    }
    const created = await createCategory(store, { name, description: null });
    categoryIdByName.set(name.toLowerCase(), created.id);
    report.categoriesCreated.push(name);
  }

  const { data: existingProducts, error } = await supabaseAdmin
    .from('products')
    .select('name')
    .eq('store_id', store.id)
    .is('archived_at', null);
  fail(error, 'Could not load the products.');
  const existingNames = new Set((existingProducts ?? []).map((p) => p.name.toLowerCase()));

  for (const choice of wantedProducts) {
    const product = byKey.get(choice.key);
    const name = choice.name ?? product.name;
    if (existingNames.has(name.toLowerCase())) {
      report.productsSkipped.push(name);
      continue;
    }
    const prices = choice.prices ?? {};
    try {
      const created = await createProduct(store, merchant, {
        name,
        description: null,
        categoryId: categoryIdByName.get(product.category.toLowerCase()) ?? null,
        unit: product.unit,
        taxPercent: choice.taxPercent ?? product.taxPercent,
        trackInventory: template.defaults.trackInventory,
        lowStockThreshold: template.defaults.lowStockThreshold,
        images: [],
        variants: product.variants.map((variant) => ({
          name: variant.name,
          pricePaise: prices[variant.name] ?? variant.pricePaise,
          weightGrams: variant.weightGrams ?? null,
          openingQuantity: 0,
        })),
      });
      existingNames.add(name.toLowerCase());
      report.productsCreated.push({ key: choice.key, productId: created.id, name });
    } catch (createError) {
      if (!createError.isOperational) throw createError;
      report.failed.push({ key: choice.key, name, code: createError.code, message: createError.message });
    }
  }

  const { error: stampError } = await supabaseAdmin
    .from('stores')
    .update({ template_applied: input.industry, template_applied_at: new Date().toISOString() })
    .eq('id', store.id);
  if (stampError) logger.warn('could not stamp the applied template', { storeId: store.id });

  return report;
}

// ── Categories ──────────────────────────────────────────────────────────────

export async function reorderCategories(store, categoryIds) {
  const { error } = await supabaseAdmin.rpc('reorder_categories', { p_store_id: store.id, p_ids: categoryIds });
  if (error) {
    if ((error.message ?? '').includes('CATEGORY_SET_MISMATCH')) {
      throw unprocessable('CATEGORY_SET_MISMATCH', "Send every one of the store's categories, each once, in the new order.");
    }
    throw internal('Could not reorder the categories.');
  }
  return listCategories(store);
}

export async function deleteCategory(store, categoryId, { moveToCategoryId = null, uncategorise = false }) {
  const { data, error } = await supabaseAdmin.rpc('delete_category', {
    p_store_id: store.id,
    p_category_id: categoryId,
    p_move_to: moveToCategoryId,
    p_uncategorise: uncategorise,
  });
  if (error) {
    const message = error.message ?? '';
    if (message.includes('CATEGORY_NOT_FOUND')) throw notFound('Category');
    if (message.includes('TARGET_NOT_FOUND')) throw notFound('Target category');
    if (message.includes('CATEGORY_NOT_EMPTY')) {
      const count = Number(message.split('CATEGORY_NOT_EMPTY:')[1]?.match(/\d+/)?.[0] ?? 0);
      throw conflict(
        `This category still has ${count} product${count === 1 ? '' : 's'}. Move them to another category, or choose to leave them uncategorised.`,
        { productCount: count },
      );
    }
    throw internal('Could not remove the category.');
  }
  return { movedProducts: Number(data ?? 0), categories: await listCategories(store) };
}

// ── Duplicate / reuse ───────────────────────────────────────────────────────

/**
 * A copy to edit: same details and variants, new SKUs, no barcodes (they
 * identify one physical product), no stock, and INACTIVE so it is not on sale
 * until the merchant has changed what differs (MERCHANT_RULES P-12).
 */
export async function duplicateProduct(store, merchant, productId, { name }) {
  const source = await getProduct(store, productId);
  const copyName = name ?? `${source.name} (Copy)`;
  const created = await createProduct(store, merchant, {
    name: copyName,
    description: source.description,
    categoryId: source.categoryId,
    unit: source.unit,
    taxPercent: source.taxPercent,
    trackInventory: source.trackInventory,
    lowStockThreshold: source.lowStockThreshold,
    images: source.images.map((image) => ({ url: image.url, altText: image.altText })),
    variants: source.variants.map((variant) => ({
      name: variant.name,
      sku: generateSku(copyName, variant.name),
      weightGrams: variant.weightGrams,
      pricePaise: variant.pricePaise,
      mrpPaise: variant.mrpPaise,
      costPaise: variant.costPaise,
      openingQuantity: 0,
    })),
  });
  const { error } = await supabaseAdmin.from('products').update({ is_available: false }).eq('id', created.id).eq('store_id', store.id);
  fail(error, 'Could not finish the copy.');
  return getProduct(store, created.id);
}

// ── Barcode and SKU lookup ──────────────────────────────────────────────────

/** Scanned or typed: the one variant of this store with that barcode or SKU. */
export async function lookupVariant(store, { barcode, sku }) {
  let query = supabaseAdmin.from('product_variants').select('id, product_id').eq('store_id', store.id);
  query = barcode ? query.eq('barcode', barcode) : query.eq('sku', sku);
  const { data, error } = await query.limit(1);
  fail(error, 'Could not look the product up.');
  const match = (data ?? [])[0];
  if (!match) throw notFound('Product with that code');

  const product = await getProduct(store, match.product_id).catch((lookupError) => {
    if (lookupError.code === 'NOT_FOUND') return null; // archived
    throw lookupError;
  });
  if (!product) throw notFound('Product with that code');
  return { product, variant: product.variants.find((variant) => variant.id === match.id) };
}
