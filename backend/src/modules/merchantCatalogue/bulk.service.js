import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, notFound, unprocessable } from '../../lib/errors.js';
import { csvToObjects, toCsv, rupeesToPaise, paiseToRupees } from '../../lib/csv.js';
import { PRODUCT_UNITS } from './catalogue.schemas.js';
import { listCategories, createCategory } from './category.service.js';
import {
  listProducts,
  createProduct,
  updateProduct,
  addVariant,
  updateVariant,
  archiveProduct,
  setProductActive,
  getProduct,
} from './product.service.js';
import { recordMovement } from '../merchantInventory/inventory.service.js';

/**
 * Import/export and bulk operations — roadmap §4 P1 "Import/export", "Bulk
 * operations": validation, preview and failed-row reporting, so large changes
 * never corrupt the catalogue silently.
 *
 * Every write goes through the ordinary product, variant and inventory paths,
 * one product at a time: the rules a hand edit obeys are the rules an import
 * obeys, and a refused product is reported without undoing the others. A
 * product whose rows contain any error is skipped whole — never half-imported.
 */

export const EXPORT_COLUMNS = [
  'product_name', 'category', 'unit', 'tax_percent', 'track_inventory', 'low_stock_threshold', 'product_active',
  'variant_name', 'sku', 'barcode', 'weight_grams', 'price', 'mrp', 'cost', 'quantity_on_hand', 'variant_active',
];

const yesNo = (value) => (value ? 'yes' : 'no');

async function allProducts(store) {
  const { products } = await listProducts(store, { page: 1, limit: 100_000 });
  return products;
}

/** The whole catalogue, one row per variant, prices in rupees. */
export async function exportCatalogue(store) {
  const rows = [];
  for (const product of await allProducts(store)) {
    for (const variant of product.variants) {
      rows.push({
        product_name: product.name,
        category: product.categoryName ?? '',
        unit: product.unit,
        tax_percent: product.taxPercent,
        track_inventory: yesNo(product.trackInventory),
        low_stock_threshold: product.lowStockThreshold ?? '',
        product_active: yesNo(product.isActive),
        variant_name: variant.name,
        sku: variant.sku ?? '',
        barcode: variant.barcode ?? '',
        weight_grams: variant.weightGrams ?? '',
        price: paiseToRupees(variant.pricePaise),
        mrp: paiseToRupees(variant.mrpPaise),
        cost: paiseToRupees(variant.costPaise),
        quantity_on_hand: variant.quantityOnHand ?? '',
        variant_active: yesNo(variant.isActive),
      });
    }
  }
  return toCsv(EXPORT_COLUMNS, rows);
}

// ── Import ──────────────────────────────────────────────────────────────────

const money = (field, { required = false } = {}) =>
  z.string().transform((text, ctx) => {
    if (text === '') {
      if (required) ctx.addIssue({ code: 'custom', message: `${field} is required.` });
      return null;
    }
    const paise = rupeesToPaise(text);
    if (Number.isNaN(paise)) ctx.addIssue({ code: 'custom', message: `${field} must be rupees, e.g. 120 or 120.50.` });
    return paise;
  });

const optionalInt = (field, max) =>
  z.string().transform((text, ctx) => {
    if (text === '') return null;
    if (!/^\d+$/.test(text) || Number(text) > max) ctx.addIssue({ code: 'custom', message: `${field} must be a whole number up to ${max}.` });
    return Number(text);
  });

const flag = (field) =>
  z.string().transform((text, ctx) => {
    if (text === '') return null;
    const value = text.toLowerCase();
    if (['yes', 'y', 'true', '1'].includes(value)) return true;
    if (['no', 'n', 'false', '0'].includes(value)) return false;
    ctx.addIssue({ code: 'custom', message: `${field} must be yes or no.` });
    return null;
  });

const rowSchema = z
  .object({
    product_name: z.string().min(1, 'product_name is required.').max(200),
    category: z.string().max(100).default(''),
    unit: z
      .string()
      .default('')
      .transform((text) => text.toLowerCase())
      .refine((text) => text === '' || PRODUCT_UNITS.includes(text), `unit must be one of ${PRODUCT_UNITS.join(', ')}.`),
    tax_percent: z
      .string()
      .default('')
      .refine((text) => text === '' || (/^\d{1,3}(\.\d{1,2})?$/.test(text) && Number(text) <= 100), 'tax_percent must be 0–100.'),
    track_inventory: flag('track_inventory').default(''),
    low_stock_threshold: optionalInt('low_stock_threshold', 100_000).default(''),
    product_active: flag('product_active').default(''),
    variant_name: z.string().max(120).default(''),
    sku: z.string().max(50).default(''),
    barcode: z.string().max(100).default(''),
    weight_grams: optionalInt('weight_grams', 1_000_000).default(''),
    price: money('price', { required: true }),
    mrp: money('mrp').default(''),
    cost: money('cost').default(''),
    quantity_on_hand: optionalInt('quantity_on_hand', 100_000).default(''),
    variant_active: flag('variant_active').default(''),
  })
  .passthrough()
  .superRefine((row, ctx) => {
    if (row.mrp !== null && row.price !== null && row.mrp < row.price) {
      ctx.addIssue({ code: 'custom', path: ['mrp'], message: 'mrp cannot be below price.' });
    }
  });

const REQUIRED_HEADERS = ['product_name', 'price'];

/**
 * Works out what an import would do, row by row, without writing anything.
 * `plan.products` is one entry per product name; any row error marks the whole
 * product as skipped.
 */
export async function planImport(store, csvText) {
  const { headers, records } = csvToObjects(csvText);
  const missingHeaders = REQUIRED_HEADERS.filter((name) => !headers.includes(name));
  if (missingHeaders.length) {
    throw unprocessable('IMPORT_HEADERS', `The file needs these columns: ${missingHeaders.join(', ')}.`, { missingHeaders, expected: EXPORT_COLUMNS });
  }
  if (records.length === 0) throw unprocessable('IMPORT_EMPTY', 'The file has no rows to import.');
  if (records.length > 5000) throw unprocessable('IMPORT_TOO_LARGE', 'Import at most 5,000 rows at a time.');

  const products = await allProducts(store);
  const productByName = new Map(products.map((p) => [p.name.toLowerCase(), p]));
  const variantBySku = new Map();
  for (const product of products) {
    for (const variant of product.variants) if (variant.sku) variantBySku.set(variant.sku.toLowerCase(), { product, variant });
  }
  const categoryNames = new Set((await listCategories(store)).map((c) => c.name.toLowerCase()));

  const rows = [];
  const groups = new Map();
  const seenSkus = new Map();
  for (const record of records) {
    const parsed = rowSchema.safeParse(record.values);
    const errors = parsed.success
      ? []
      : parsed.error.issues.map((issue) => ({ field: String(issue.path[0] ?? 'row'), message: issue.message }));
    const data = parsed.success ? parsed.data : null;

    if (data?.sku) {
      const key = data.sku.toLowerCase();
      if (seenSkus.has(key)) errors.push({ field: 'sku', message: `SKU repeats line ${seenSkus.get(key)}.` });
      else seenSkus.set(key, record.line);
    }

    const name = (record.values.product_name ?? '').trim();
    const existingBySku = data?.sku ? variantBySku.get(data.sku.toLowerCase()) : null;
    if (existingBySku && existingBySku.product.name.toLowerCase() !== name.toLowerCase()) {
      errors.push({ field: 'sku', message: `SKU ${data.sku} belongs to "${existingBySku.product.name}".` });
    }

    const existingProduct = productByName.get(name.toLowerCase()) ?? null;
    const variantName = data?.variant_name || 'Default';
    const existingVariant =
      existingBySku?.variant ??
      existingProduct?.variants.find((variant) => variant.name.toLowerCase() === variantName.toLowerCase()) ??
      null;

    const action = errors.length ? 'error' : !existingProduct ? 'create' : existingVariant ? 'update' : 'add_variant';
    const row = { line: record.line, productName: name, variantName, sku: data?.sku || null, action, errors, data, existingVariant };
    rows.push(row);

    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name, existingProduct, rows: [] });
    groups.get(key).rows.push(row);
  }

  const plan = [...groups.values()].map((group) => ({
    productName: group.name,
    action: group.rows.some((row) => row.action === 'error') ? 'skip' : group.existingProduct ? 'update' : 'create',
    lines: group.rows.map((row) => row.line),
    newCategory:
      group.rows[0]?.data?.category && !categoryNames.has(group.rows[0].data.category.toLowerCase())
        ? group.rows[0].data.category
        : null,
  }));

  return {
    rows,
    groups: [...groups.values()],
    preview: {
      rowCount: rows.length,
      failedRows: rows
        .filter((row) => row.action === 'error')
        .map((row) => ({ line: row.line, productName: row.productName, errors: row.errors })),
      products: plan,
      summary: {
        productsToCreate: plan.filter((p) => p.action === 'create').length,
        productsToUpdate: plan.filter((p) => p.action === 'update').length,
        productsSkipped: plan.filter((p) => p.action === 'skip').length,
        newCategories: [...new Set(plan.map((p) => p.newCategory).filter(Boolean))],
      },
    },
  };
}

async function categoryIdFor(store, name, cache) {
  if (!name) return null;
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const created = await createCategory(store, { name, description: null });
  cache.set(key, created.id);
  return created.id;
}

/** Applies the valid part of an import; returns what happened to every line. */
export async function commitImport(store, merchant, csvText) {
  const { groups, preview } = await planImport(store, csvText);
  const categories = new Map((await listCategories(store)).map((c) => [c.name.toLowerCase(), c.id]));
  const results = [];

  for (const group of groups) {
    if (group.rows.some((row) => row.action === 'error')) {
      for (const row of group.rows) {
        results.push({
          line: row.line,
          status: 'skipped',
          errors: row.errors.length ? row.errors : [{ field: 'product_name', message: 'Another row of this product has an error.' }],
        });
      }
      continue;
    }

    try {
      const first = group.rows[0].data;
      const categoryId = await categoryIdFor(store, first.category, categories);
      const productFields = {
        ...(first.unit ? { unit: first.unit } : {}),
        ...(first.tax_percent !== '' ? { taxPercent: Number(first.tax_percent) } : {}),
        ...(first.track_inventory !== null ? { trackInventory: first.track_inventory } : {}),
        ...(first.low_stock_threshold !== null ? { lowStockThreshold: first.low_stock_threshold } : {}),
      };

      let product;
      if (!group.existingProduct) {
        product = await createProduct(store, merchant, {
          name: group.name,
          description: null,
          categoryId,
          unit: productFields.unit ?? 'pcs',
          taxPercent: productFields.taxPercent,
          trackInventory: productFields.trackInventory,
          lowStockThreshold: productFields.lowStockThreshold,
          images: [],
          variants: group.rows.map(({ data, variantName }) => ({
            name: variantName,
            sku: data.sku || undefined,
            barcode: data.barcode || null,
            weightGrams: data.weight_grams,
            pricePaise: data.price,
            mrpPaise: data.mrp,
            costPaise: data.cost,
            openingQuantity: data.quantity_on_hand ?? 0,
          })),
        });
        for (const row of group.rows) results.push({ line: row.line, status: 'created', productId: product.id });
      } else {
        product = await updateProduct(store, group.existingProduct.id, {
          ...productFields,
          ...(first.category ? { categoryId } : {}),
        });
        for (const row of group.rows) {
          const { data, variantName } = row;
          try {
            if (row.existingVariant) {
              await updateVariant(store, product.id, row.existingVariant.id, {
                name: variantName,
                ...(data.sku ? { sku: data.sku } : {}),
                ...(data.barcode ? { barcode: data.barcode } : {}),
                ...(data.weight_grams !== null ? { weightGrams: data.weight_grams } : {}),
                pricePaise: data.price,
                ...(data.mrp !== null ? { mrpPaise: data.mrp } : {}),
                ...(data.cost !== null ? { costPaise: data.cost } : {}),
              });
              if (
                data.quantity_on_hand !== null &&
                product.trackInventory &&
                data.quantity_on_hand !== row.existingVariant.quantityOnHand
              ) {
                await recordMovement(store, merchant, 'adjustment', {
                  variantId: row.existingVariant.id,
                  newQuantity: data.quantity_on_hand,
                  reason: 'Catalogue import',
                });
              }
              results.push({ line: row.line, status: 'updated', productId: product.id });
            } else {
              await addVariant(store, merchant, product.id, {
                name: variantName,
                sku: data.sku || undefined,
                barcode: data.barcode || null,
                weightGrams: data.weight_grams,
                pricePaise: data.price,
                mrpPaise: data.mrp,
                costPaise: data.cost,
                openingQuantity: data.quantity_on_hand ?? 0,
              });
              results.push({ line: row.line, status: 'created', productId: product.id });
            }
          } catch (rowError) {
            if (!rowError.isOperational) throw rowError;
            results.push({ line: row.line, status: 'failed', errors: [{ field: 'row', message: rowError.message, code: rowError.code }] });
          }
        }
      }
    } catch (groupError) {
      if (!groupError.isOperational) throw groupError;
      for (const row of group.rows) {
        results.push({ line: row.line, status: 'failed', errors: [{ field: 'row', message: groupError.message, code: groupError.code }] });
      }
    }
  }

  results.sort((a, b) => a.line - b.line);
  return {
    results,
    summary: {
      created: results.filter((r) => r.status === 'created').length,
      updated: results.filter((r) => r.status === 'updated').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
    },
    preview: preview.summary,
  };
}

// ── Bulk operations ─────────────────────────────────────────────────────────

/**
 * One action over many products. `preview` says what each item would become
 * (and why it would be refused) without writing; otherwise each item is
 * applied on its own and the result reported per item.
 */
export async function bulkProducts(store, merchant, input) {
  const loaded = [];
  for (const productId of input.productIds) {
    try {
      loaded.push({ productId, product: await getProduct(store, productId) });
    } catch (error) {
      if (error.code !== 'NOT_FOUND') throw error;
      loaded.push({ productId, product: null });
    }
  }

  if (input.action === 'set_category' && input.categoryId) {
    const categories = await listCategories(store);
    if (!categories.some((c) => c.id === input.categoryId)) throw notFound('Category');
  }

  const results = [];
  for (const { productId, product } of loaded) {
    if (!product) {
      results.push({ productId, status: 'failed', errors: [{ code: 'NOT_FOUND', message: 'Product was not found.' }] });
      continue;
    }
    const plan = planBulkItem(product, input);
    if (plan.errors.length) {
      results.push({ productId, name: product.name, status: 'failed', before: plan.before, after: plan.after, errors: plan.errors });
      continue;
    }
    if (input.preview) {
      results.push({ productId, name: product.name, status: 'ok', before: plan.before, after: plan.after });
      continue;
    }
    try {
      await applyBulkItem(store, merchant, product, input, plan);
      results.push({ productId, name: product.name, status: 'applied', before: plan.before, after: plan.after });
    } catch (error) {
      if (!error.isOperational) throw error;
      results.push({ productId, name: product.name, status: 'failed', errors: [{ code: error.code, message: error.message }] });
    }
  }

  return {
    action: input.action,
    preview: Boolean(input.preview),
    results,
    summary: {
      total: results.length,
      ok: results.filter((r) => r.status === 'ok' || r.status === 'applied').length,
      failed: results.filter((r) => r.status === 'failed').length,
    },
  };
}

const roundPaise = (value) => Math.round(value);

function planBulkItem(product, input) {
  const errors = [];
  switch (input.action) {
    case 'archive':
      return { before: { archived: false }, after: { archived: true }, errors };
    case 'activate':
    case 'deactivate':
      return { before: { isActive: product.isActive }, after: { isActive: input.action === 'activate' }, errors };
    case 'set_category':
      return { before: { categoryId: product.categoryId }, after: { categoryId: input.categoryId ?? null }, errors };
    case 'set_tax':
      return { before: { taxPercent: product.taxPercent }, after: { taxPercent: input.taxPercent }, errors };
    case 'set_low_stock_threshold':
      if (!product.trackInventory) errors.push({ code: 'NOT_TRACKED', message: 'Stock is not counted for this product.' });
      return { before: { lowStockThreshold: product.lowStockThreshold }, after: { lowStockThreshold: input.threshold }, errors };
    case 'adjust_price_percent': {
      const variants = product.variants.map((variant) => {
        const next = roundPaise((variant.pricePaise * (100 + input.percent)) / 100);
        if (next < 0) errors.push({ code: 'PRICE_INVALID', message: `${variant.name} would cost less than nothing.` });
        if (variant.mrpPaise !== null && next > variant.mrpPaise) {
          errors.push({ code: 'ABOVE_MRP', message: `${variant.name} would cost more than its MRP (${paiseToRupees(variant.mrpPaise)}).` });
        }
        return { variantId: variant.id, name: variant.name, from: variant.pricePaise, to: next };
      });
      return {
        before: { prices: variants.map((v) => ({ variantId: v.variantId, pricePaise: v.from })) },
        after: { prices: variants.map((v) => ({ variantId: v.variantId, pricePaise: v.to })) },
        errors,
        variants,
      };
    }
    case 'stock_in': {
      if (!product.trackInventory) errors.push({ code: 'NOT_TRACKED', message: 'Stock is not counted for this product.' });
      const active = product.variants.filter((variant) => variant.isActive);
      if (active.length !== 1) {
        errors.push({ code: 'VARIANT_REQUIRED', message: 'This product has several variants; receive stock per variant from the Stock screen.' });
      }
      const variant = active[0];
      return {
        before: { quantityOnHand: variant?.quantityOnHand ?? null },
        after: { quantityOnHand: (variant?.quantityOnHand ?? 0) + input.quantity },
        errors,
        variant,
      };
    }
    default:
      return { before: {}, after: {}, errors: [{ code: 'UNKNOWN_ACTION', message: 'Unknown action.' }] };
  }
}

async function applyBulkItem(store, merchant, product, input, plan) {
  switch (input.action) {
    case 'archive':
      return archiveProduct(store, product.id);
    case 'activate':
    case 'deactivate':
      return setProductActive(store, product.id, input.action === 'activate');
    case 'set_category':
      return updateProduct(store, product.id, { categoryId: input.categoryId ?? null });
    case 'set_tax':
      return updateProduct(store, product.id, { taxPercent: input.taxPercent });
    case 'set_low_stock_threshold':
      return updateProduct(store, product.id, { lowStockThreshold: input.threshold });
    case 'adjust_price_percent':
      for (const variant of plan.variants) {
        if (variant.from !== variant.to) await updateVariant(store, product.id, variant.variantId, { pricePaise: variant.to });
      }
      return null;
    case 'stock_in':
      return recordMovement(store, merchant, 'stock_in', {
        variantId: plan.variant.id,
        quantity: input.quantity,
        notes: input.notes ?? 'Bulk stock in',
      });
    default:
      throw internal('Unknown bulk action.');
  }
}
