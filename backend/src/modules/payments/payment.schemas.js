import { z } from 'zod';

export const orderIdParams = z
  .object({ orderId: z.string().uuid('Not a valid order.') })
  .strict();

/**
 * Checklist 7.12. What the browser brings back from the gateway. `outcome` is
 * the mock provider's stand-in for a real gateway's signed response — it is
 * what the provider inspects, never what the API believes on its own.
 */
export const verifyPaymentSchema = z
  .object({
    providerRef: z.string().trim().min(1).max(200).optional(),
    outcome: z.enum(['success', 'failure', 'cancel', 'pending']).optional(),
  })
  .strict();

/** The webhook body. Deliberately loose on payload, strict on what we read. */
export const webhookSchema = z
  .object({
    event: z.string().trim().min(1).max(60),
    // A payment event names the payment; a refund event names the refund.
    providerRef: z.string().trim().min(1).max(200).optional(),
    providerRefundRef: z.string().trim().min(1).max(200).optional(),
    // The gateway's own event id, so a replayed delivery is recognised.
    eventId: z.string().trim().min(1).max(200).optional(),
    amountPaise: z.number().int().nonnegative().nullish(),
    failureReason: z.string().trim().max(300).nullish(),
  })
  .passthrough()
  .refine((body) => Boolean(body.providerRef || body.providerRefundRef), {
    message: 'A webhook must name the payment (providerRef) or the refund (providerRefundRef).',
    path: ['providerRef'],
  });
