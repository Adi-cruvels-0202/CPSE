import { z } from 'zod';

/**
 * A counter sale — MERCHANT_API.md, P1 endpoints; MERCHANT_RULES §8.
 * `.strict()` throughout (D20).
 */

const uuid = (what) => z.string().uuid(`Not a valid ${what}.`);

export const saleParams = z.object({ storeId: uuid('store'), saleId: uuid('sale') }).strict();

export const createSaleSchema = z
  .object({
    items: z
      .array(
        z
          .object({ variantId: uuid('variant'), quantity: z.number().int('Use a whole number.').min(1).max(10_000) })
          .strict(),
      )
      .min(1, 'Add at least one item.')
      .max(100, 'At most 100 lines on one sale.')
      .refine((items) => new Set(items.map((item) => item.variantId)).size === items.length, {
        message: 'Each item once — put the total quantity on one line.',
      }),
    paymentMethod: z.enum(['cash', 'upi', 'card', 'other']),
    customerName: z.string().trim().min(1).max(120).nullish(),
    customerPhone: z.string().trim().regex(/^\+?[0-9]{7,15}$/, 'Enter a valid phone number.').nullish(),
    // Off the whole bill, never more than it (MERCHANT_RULES X-4).
    discountPaise: z.number().int('Use whole paise.').min(0).default(0),
    notes: z.string().trim().max(500).nullish(),
  })
  .strict();

export const saleListQuery = z
  .object({
    from: z.string().datetime({ offset: true, message: 'Use an ISO date-time.' }).optional(),
    to: z.string().datetime({ offset: true, message: 'Use an ISO date-time.' }).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();
