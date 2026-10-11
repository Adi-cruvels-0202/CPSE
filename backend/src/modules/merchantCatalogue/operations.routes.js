import express, { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireMerchant } from '../../middleware/requireMerchant.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { unprocessable } from '../../lib/errors.js';
import { ownStore, storeIdParams, uuid, respond, respondPage, pageQuery } from '../../lib/merchantRoute.js';
import { emptyBody } from '../../lib/schemas.js';
import { INDUSTRIES, templateSummaries } from '../../lib/industryTemplates.js';
import * as operations from './operations.service.js';
import * as bulk from './bulk.service.js';
import * as purchases from '../merchantPurchases/purchase.service.js';

/**
 * Catalogue operations that cut repeated work (roadmap §4 P1): templates and
 * defaults, category reorder/removal, duplicate, barcode lookup, suppliers and
 * purchases, CSV import/export and bulk actions. Mounted under /merchant.
 */
export const operationsRouter = Router();

const taxPercent = z
  .number()
  .min(0)
  .max(100)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, 'Use at most two decimals.');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

// ── Templates ───────────────────────────────────────────────────────────────

operationsRouter.get('/templates', requireAuth, requireMerchant, respond(async () => ({ templates: templateSummaries() })));

operationsRouter.get(
  '/templates/:industry',
  requireAuth,
  validate({ params: z.object({ industry: z.enum(INDUSTRIES) }).strict() }),
  requireMerchant,
  respond(async (req) => ({ template: operations.getTemplate(req.params.industry) })),
);

const templateProductChoice = z
  .object({
    key: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(200).optional(),
    taxPercent: taxPercent.optional(),
    // Variant name → the merchant's own price, in paise.
    prices: z.record(z.string().max(120), z.number().int().min(0).max(100_000_000)).optional(),
  })
  .strict();

operationsRouter.post(
  '/stores/:storeId/templates/apply',
  ...ownStore({
    write: true,
    body: z
      .object({
        industry: z.enum(INDUSTRIES),
        applyDefaults: z.boolean().default(true),
        categories: z.union([z.literal('all'), z.array(z.string().trim().min(1).max(100)).max(50)]).default('all'),
        products: z.union([z.literal('all'), z.array(templateProductChoice).max(100)]).default([]),
      })
      .strict(),
  }),
  respond(async (req) => ({ report: await operations.applyTemplate(req.store, req.merchant, req.body) }), { created: true }),
);

operationsRouter.get(
  '/stores/:storeId/defaults',
  ...ownStore(),
  respond(async (req) => ({ defaults: operations.toDefaults(req.store) })),
);

operationsRouter.put(
  '/stores/:storeId/defaults',
  ...ownStore({
    body: z
      .object({
        lowStockThreshold: z.number().int().min(0).max(100_000).nullable().optional(),
        taxPercent: taxPercent.optional(),
        trackInventory: z.boolean().optional(),
        expiryAlertDays: z.number().int().min(0).max(365).optional(),
      })
      .strict(),
  }),
  respond(async (req) => ({ defaults: await operations.updateDefaults(req.store, req.body) })),
);

// ── Categories ──────────────────────────────────────────────────────────────

operationsRouter.put(
  '/stores/:storeId/categories/order',
  ...ownStore({ body: z.object({ categoryIds: z.array(uuid('category')).max(500) }).strict() }),
  respond(async (req) => ({ categories: await operations.reorderCategories(req.store, req.body.categoryIds) })),
);

operationsRouter.delete(
  '/stores/:storeId/categories/:categoryId',
  ...ownStore({
    params: storeIdParams({ categoryId: uuid('category') }),
    body: z
      .object({ moveToCategoryId: uuid('category').optional(), uncategorise: z.boolean().optional() })
      .strict()
      .refine((v) => !(v.moveToCategoryId && v.uncategorise), {
        message: 'Either move the products or leave them uncategorised, not both.',
        path: ['uncategorise'],
      }),
    write: true,
  }),
  respond(async (req) => operations.deleteCategory(req.store, req.params.categoryId, req.body)),
);

// ── Products: duplicate, lookup ─────────────────────────────────────────────

operationsRouter.post(
  '/stores/:storeId/products/:productId/duplicate',
  ...ownStore({
    params: storeIdParams({ productId: uuid('product') }),
    body: z.object({ name: z.string().trim().min(1).max(200).optional() }).strict(),
    write: true,
  }),
  respond(async (req) => ({ product: await operations.duplicateProduct(req.store, req.merchant, req.params.productId, req.body) }), {
    created: true,
  }),
);

operationsRouter.get(
  '/stores/:storeId/product-lookup',
  ...ownStore({
    query: z
      .object({ barcode: z.string().trim().min(1).max(100).optional(), sku: z.string().trim().min(1).max(50).optional() })
      .strict()
      .refine((v) => Boolean(v.barcode) !== Boolean(v.sku), { message: 'Send a barcode or a SKU.', path: ['barcode'] }),
  }),
  respond(async (req) => operations.lookupVariant(req.store, req.query)),
);

// ── Import / export ─────────────────────────────────────────────────────────

operationsRouter.get(
  '/stores/:storeId/catalogue/export',
  ...ownStore(),
  asyncHandler(async (req, res) => {
    const csv = await bulk.exportCatalogue(req.store);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.store.slug}-catalogue.csv"`);
    res.send(csv);
  }),
);

// The file is the body (Content-Type: text/csv), up to 2 MB — far beyond the
// JSON cap, which is for carts and forms.
const csvBody = express.text({ type: ['text/csv', 'text/plain', 'application/csv'], limit: '2mb' });
const requireCsv = (req, res, next) => {
  if (typeof req.body !== 'string' || req.body.trim() === '') {
    return next(unprocessable('IMPORT_EMPTY', 'Send the CSV file as the request body with Content-Type: text/csv.'));
  }
  return next();
};

operationsRouter.post(
  '/stores/:storeId/catalogue/import',
  ...ownStore({ query: z.object({ mode: z.enum(['preview', 'commit']).default('preview') }).strict(), write: true }),
  csvBody,
  requireCsv,
  respond(async (req) =>
    req.query.mode === 'preview'
      ? { mode: 'preview', ...(await bulk.planImport(req.store, req.body)).preview }
      : { mode: 'commit', ...(await bulk.commitImport(req.store, req.merchant, req.body)) },
  ),
);

operationsRouter.post(
  '/stores/:storeId/products/bulk',
  ...ownStore({
    write: true,
    body: z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('archive') }),
        z.object({ action: z.literal('activate') }),
        z.object({ action: z.literal('deactivate') }),
        z.object({ action: z.literal('set_category'), categoryId: uuid('category').nullable() }),
        z.object({ action: z.literal('set_tax'), taxPercent }),
        z.object({ action: z.literal('set_low_stock_threshold'), threshold: z.number().int().min(0).max(100_000).nullable() }),
        z.object({ action: z.literal('adjust_price_percent'), percent: z.number().min(-90).max(500) }),
        z.object({
          action: z.literal('stock_in'),
          quantity: z.number().int().min(1).max(100_000),
          notes: z.string().trim().max(500).optional(),
        }),
      ])
      .and(
        z.object({
          productIds: z.array(uuid('product')).min(1, 'Choose at least one product.').max(200),
          preview: z.boolean().default(true),
        }),
      ),
  }),
  respond(async (req) => ({ bulk: await bulk.bulkProducts(req.store, req.merchant, req.body) })),
);

// ── Suppliers ───────────────────────────────────────────────────────────────

const supplierFields = {
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().regex(/^\+?[0-9]{7,15}$/, 'Enter a valid phone number.').nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN.')
    .nullable()
    .optional(),
  address: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
};

operationsRouter.get(
  '/stores/:storeId/suppliers',
  ...ownStore({ query: z.object({ includeInactive: z.enum(['true', 'false']).transform((v) => v === 'true').optional() }).strict() }),
  respond(async (req) => ({ suppliers: await purchases.listSuppliers(req.store, req.query) })),
);

operationsRouter.post(
  '/stores/:storeId/suppliers',
  ...ownStore({ body: z.object(supplierFields).strict(), write: true }),
  respond(async (req) => ({ supplier: await purchases.createSupplier(req.store, req.body) }), { created: true }),
);

operationsRouter.patch(
  '/stores/:storeId/suppliers/:supplierId',
  ...ownStore({
    params: storeIdParams({ supplierId: uuid('supplier') }),
    body: z
      .object({ ...supplierFields, name: supplierFields.name.optional(), isActive: z.boolean().optional() })
      .strict()
      .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field.' }),
  }),
  respond(async (req) => ({ supplier: await purchases.updateSupplier(req.store, req.params.supplierId, req.body) })),
);

// ── Purchases ───────────────────────────────────────────────────────────────

const purchaseItem = z
  .object({
    variantId: uuid('variant'),
    quantity: z.number().int().min(1).max(100_000),
    unitCostPaise: z.number().int().min(0).max(100_000_000),
    taxPaise: z.number().int().min(0).max(100_000_000).optional(),
    batchNumber: z.string().trim().min(1).max(60).nullable().optional(),
    manufacturedOn: isoDate.nullable().optional(),
    expiresOn: isoDate.nullable().optional(),
  })
  .strict()
  .refine((v) => !v.expiresOn || !v.manufacturedOn || v.expiresOn >= v.manufacturedOn, {
    message: 'The expiry date cannot be before the manufacturing date.',
    path: ['expiresOn'],
  });

const purchaseBody = z
  .object({
    supplierId: uuid('supplier').nullable().optional(),
    supplierName: z.string().trim().min(1).max(160).nullable().optional(),
    invoiceNumber: z.string().trim().min(1).max(60).nullable().optional(),
    invoiceDate: isoDate.nullable().optional(),
    purchaseDate: isoDate.optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    items: z.array(purchaseItem).max(200),
    confirm: z.boolean().default(false),
  })
  .strict();

const purchaseParams = storeIdParams({ purchaseId: uuid('purchase') });

operationsRouter.get(
  '/stores/:storeId/purchases',
  ...ownStore({
    query: pageQuery({ status: z.enum(['draft', 'confirmed', 'cancelled']).optional(), supplierId: uuid('supplier').optional() }),
  }),
  respondPage(async (req) => {
    const { purchases: rows, total } = await purchases.listPurchases(req.store, req.query);
    return { data: { purchases: rows }, total };
  }),
);

operationsRouter.post(
  '/stores/:storeId/purchases',
  ...ownStore({ body: purchaseBody, write: true }),
  respond(async (req) => ({ purchase: await purchases.createPurchase(req.store, req.merchant, req.body) }), { created: true }),
);

operationsRouter.get(
  '/stores/:storeId/purchases/:purchaseId',
  ...ownStore({ params: purchaseParams }),
  respond(async (req) => ({ purchase: await purchases.getPurchase(req.store, req.params.purchaseId) })),
);

operationsRouter.put(
  '/stores/:storeId/purchases/:purchaseId',
  ...ownStore({ params: purchaseParams, body: purchaseBody, write: true }),
  respond(async (req) => ({ purchase: await purchases.updatePurchase(req.store, req.merchant, req.params.purchaseId, req.body) })),
);

operationsRouter.post(
  '/stores/:storeId/purchases/:purchaseId/confirm',
  ...ownStore({ params: purchaseParams, body: emptyBody, write: true }),
  respond(async (req) => ({ purchase: await purchases.confirmPurchase(req.store, req.merchant, req.params.purchaseId) })),
);

operationsRouter.post(
  '/stores/:storeId/purchases/:purchaseId/cancel',
  ...ownStore({ params: purchaseParams, body: emptyBody, write: true }),
  respond(async (req) => ({ purchase: await purchases.cancelPurchase(req.store, req.params.purchaseId) })),
);
