import { z } from 'zod';
import { ORDER_STATUSES } from '../orders/order.state.js';

/**
 * Request shapes for a merchant's orders — MERCHANT_API.md, Orders.
 * `.strict()` throughout (D20).
 */

const uuid = (what) => z.string().uuid(`Not a valid ${what}.`);

export const orderParams = z.object({ storeId: uuid('store'), orderId: uuid('order') }).strict();

const statusList = z
  .string()
  .trim()
  .transform((value) => value.split(',').map((part) => part.trim()).filter(Boolean))
  .pipe(z.array(z.enum(ORDER_STATUSES)).min(1, 'Name at least one status.'));

export const orderListQuery = z
  .object({
    // A comma list: ?status=placed,accepted
    status: statusList.optional(),
    fulfilmentMode: z.enum(['pickup', 'delivery']).optional(),
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

export const rejectSchema = z.object({ reason: z.string().trim().min(1).max(300).optional() }).strict();

/** The customer is told why, so a cancellation needs a real reason. */
export const cancelSchema = z
  .object({ reason: z.string().trim().min(3, 'Tell the customer why (3 characters or more).').max(300) })
  .strict();

/** The steps in between; accept, reject, complete and cancel have their own routes. */
export const statusSchema = z
  .object({ status: z.enum(['preparing', 'ready_for_pickup', 'out_for_delivery']) })
  .strict();
