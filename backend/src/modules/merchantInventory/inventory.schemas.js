import { z } from 'zod';

/**
 * Request shapes for a merchant's stock movements — MERCHANT_API.md,
 * Inventory. `.strict()` throughout (D20).
 */

export const STOCK_OUT_REASONS = ['damaged', 'expired', 'lost', 'returned_to_supplier', 'own_use', 'other'];

export const MOVEMENT_TYPES = [
  'stock_in', 'stock_out', 'adjustment', 'order_reserved', 'order_released', 'order_fulfilled', 'sale', 'purchase',
];

const variantId = z.string().uuid('Not a valid variant.');
const quantity = z.number().int('Use a whole number.').min(1).max(100_000);
const notes = z.string().trim().max(500).nullish();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

export const stockInSchema = z
  .object({
    variantId,
    quantity,
    // What was paid per unit for this delivery; recorded on the ledger row.
    unitCostPaise: z.number().int('Use whole paise.').min(0).max(1_000_000_000).nullish(),
    notes,
    // A lot with an expiry (migration 0040): opens a batch for this delivery.
    batchNumber: z.string().trim().min(1).max(60).nullish(),
    manufacturedOn: isoDate.nullish(),
    expiresOn: isoDate.nullish(),
  })
  .strict()
  .refine((v) => !v.expiresOn || !v.manufacturedOn || v.expiresOn >= v.manufacturedOn, {
    message: 'The expiry date cannot be before the manufacturing date.',
    path: ['expiresOn'],
  });

export const stockOutSchema = z
  .object({
    variantId,
    quantity,
    reason: z.enum(STOCK_OUT_REASONS),
    notes,
    // The lot this stock leaves from — e.g. the expired batch being written off.
    batchId: z.string().uuid('Not a valid batch.').nullish(),
  })
  .strict();

export const batchListQuery = z
  .object({
    status: z.enum(['active', 'expiring', 'expired', 'all']).default('active'),
    variantId: variantId.optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
  })
  .strict();

/** A physical count: on hand becomes `newQuantity`. The reason is required. */
export const adjustSchema = z
  .object({
    variantId,
    newQuantity: z.number().int('Use a whole number.').min(0).max(1_000_000),
    reason: z.string().trim().min(1, 'Say why the count changed.').max(300),
  })
  .strict();

export const historyQuery = z
  .object({
    variantId: variantId.optional(),
    productId: z.string().uuid('Not a valid product.').optional(),
    movementType: z.enum(MOVEMENT_TYPES).optional(),
    from: z.string().datetime({ offset: true, message: 'Use an ISO date-time.' }).optional(),
    to: z.string().datetime({ offset: true, message: 'Use an ISO date-time.' }).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict()
  .refine((value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to), {
    message: '`from` must not be after `to`.',
    path: ['from'],
  });
