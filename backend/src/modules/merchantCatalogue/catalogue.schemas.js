import { z } from 'zod';

/**
 * Request shapes for a merchant's catalogue — MERCHANT_API.md, Categories and
 * Products and variants; limits from MERCHANT_RULES §3 – §4. `.strict()`
 * throughout (D20).
 */

export const PRODUCT_UNITS = [
  'pcs', 'kg', 'g', 'l', 'ml', 'm', 'cm', 'dozen', 'pack', 'box', 'pair', 'set', 'roll', 'plate', 'serving',
];

const nonEmpty = (schema) =>
  schema.refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update.' });

const uuid = (what) => z.string().uuid(`Not a valid ${what}.`);

// ── Params ───────────────────────────────────────────────────────────────────

export const categoryParams = z.object({ storeId: uuid('store'), categoryId: uuid('category') }).strict();
export const productParams = z.object({ storeId: uuid('store'), productId: uuid('product') }).strict();
export const variantParams = z
  .object({ storeId: uuid('store'), productId: uuid('product'), variantId: uuid('variant') })
  .strict();

// ── Categories ───────────────────────────────────────────────────────────────

const categoryName = z.string().trim().min(1, 'Enter a name.').max(100);
const categoryDescription = z.string().trim().max(500).nullish();

export const createCategorySchema = z.object({ name: categoryName, description: categoryDescription }).strict();
export const updateCategorySchema = nonEmpty(
  z.object({ name: categoryName.optional(), description: categoryDescription }).strict(),
);

// ── Variants ─────────────────────────────────────────────────────────────────

/** Whole paise, capped well below the integer column's limit. */
const paise = z.number().int('Use whole paise.').min(0).max(1_000_000_000);

const sku = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dots, hyphens and underscores.');

const variantName = z.string().trim().min(1, 'Enter a name.').max(120);

const mrpNotBelowPrice = {
  check: (value) => value.mrpPaise == null || value.pricePaise == null || value.mrpPaise >= value.pricePaise,
  issue: { message: 'The MRP cannot be below the price.', path: ['mrpPaise'] },
};

const variantFields = {
  name: variantName,
  sku: sku.optional(),
  barcode: z.string().trim().min(1).max(100).nullish(),
  weightGrams: z.number().int().positive().max(10_000_000).nullish(),
  pricePaise: paise,
  mrpPaise: paise.nullish(),
  // What the merchant paid. Never shown to customers (MERCHANT_RULES P-11).
  costPaise: paise.nullish(),
  // Goes on the shelf as a logged stock_in; stock otherwise moves only through
  // the inventory endpoints (D-5).
  openingQuantity: z.number().int().min(0).max(100_000).default(0),
};

export const variantSchema = z.object(variantFields).strict().refine(mrpNotBelowPrice.check, mrpNotBelowPrice.issue);

export const updateVariantSchema = nonEmpty(
  z
    .object({
      name: variantName.optional(),
      sku: sku.optional(),
      barcode: variantFields.barcode,
      weightGrams: variantFields.weightGrams,
      pricePaise: paise.optional(),
      mrpPaise: variantFields.mrpPaise,
      costPaise: variantFields.costPaise,
    })
    .strict(),
);

// ── Products ─────────────────────────────────────────────────────────────────

/** 0 – 100 with at most two decimals, e.g. 5, 12, 2.5 (numeric(5,2)). */
const taxPercent = z
  .number()
  .min(0)
  .max(100)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, 'Use at most two decimals.');

const image = z
  .object({
    url: z
      .string()
      .trim()
      .max(2048)
      .url('Enter a valid image URL.')
      .refine((value) => /^https?:\/\//i.test(value), 'Use an http or https URL.'),
    altText: z.string().trim().max(200).nullish(),
  })
  .strict();

const productFields = {
  name: z.string().trim().min(1, 'Enter a name.').max(200),
  description: z.string().trim().max(2000).nullish(),
  categoryId: uuid('category').nullish(),
  unit: z.enum(PRODUCT_UNITS),
  taxPercent,
  trackInventory: z.boolean(),
  lowStockThreshold: z.number().int().min(0).max(100_000).nullish(),
  images: z.array(image).max(10, 'At most 10 images.'),
};

const lowered = (value) => value.toLowerCase();
const allDifferent = (values) => new Set(values).size === values.length;

export const createProductSchema = z
  .object({
    ...productFields,
    unit: productFields.unit.default('pcs'),
    taxPercent: taxPercent.default(0),
    trackInventory: z.boolean().default(true),
    images: productFields.images.default([]),
    variants: z.array(variantSchema).min(1, 'Add at least one variant.').max(50, 'At most 50 variants.'),
  })
  .strict()
  .refine((value) => allDifferent(value.variants.map((v) => lowered(v.name))), {
    message: 'Each variant needs a different name.',
    path: ['variants'],
  })
  .refine((value) => allDifferent(value.variants.filter((v) => v.sku).map((v) => lowered(v.sku))), {
    message: 'Each variant needs a different SKU.',
    path: ['variants'],
  })
  .refine((value) => value.trackInventory || value.variants.every((v) => v.openingQuantity === 0), {
    message: 'Opening stock needs stock tracking on.',
    path: ['trackInventory'],
  });

export const updateProductSchema = nonEmpty(
  z
    .object({
      name: productFields.name.optional(),
      description: productFields.description,
      // null takes the product out of its category.
      categoryId: productFields.categoryId,
      unit: productFields.unit.optional(),
      taxPercent: taxPercent.optional(),
      trackInventory: z.boolean().optional(),
      lowStockThreshold: productFields.lowStockThreshold,
      // Replaces the whole list; [] removes every image.
      images: productFields.images.optional(),
    })
    .strict(),
);

const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

export const productListQuery = z
  .object({
    search: z.string().trim().min(1).max(100).optional(),
    categoryId: uuid('category').optional(),
    isActive: booleanQuery.optional(),
    lowStock: booleanQuery.optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();
