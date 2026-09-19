import { z } from 'zod';
import { ORDER_STATUSES } from './order.state.js';
import { fulfilmentMode } from '../checkout/checkout.schemas.js';

/** Checklist 7.4. The order body is the quote's inputs plus a payment choice. */
export const createOrderSchema = z
  .object({
    storeId: z.string().uuid('Not a valid store.'),
    fulfilmentMode,
    addressId: z.string().uuid('Not a valid address.').nullish(),
    customerNote: z.string().trim().max(500).nullish(),
    paymentMethod: z.enum(['cash', 'online'], {
      errorMap: () => ({ message: 'Choose either cash or online payment.' }),
    }),
    // The totals the customer was shown. If the cart has moved since, the
    // order is refused rather than silently charging a different number.
    expectedTotalPaise: z.number().int().nonnegative().optional(),
  })
  .strict();

/** Checklist 8.1 */
export const orderListQuery = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    storeId: z.string().uuid('Not a valid store.').optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(20),
  })
  .strict();

export const orderParams = z.object({ id: z.string().uuid('Not a valid order.') }).strict();

/** Checklist 8.4 */
export const cancelOrderSchema = z
  .object({ reason: z.string().trim().max(300).nullish() })
  .strict();

/**
 * Checklist 8.8. The test-only merchant endpoint. Kept in this file rather
 * than hidden away so it is obvious in review what it accepts.
 */
export const advanceOrderSchema = z
  .object({
    status: z.enum(ORDER_STATUSES),
    note: z.string().trim().max(300).nullish(),
  })
  .strict();
