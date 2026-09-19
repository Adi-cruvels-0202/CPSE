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
    providerRef: z.string().trim().min(1).max(200),
    amountPaise: z.number().int().nonnegative().nullish(),
    failureReason: z.string().trim().max(300).nullish(),
  })
  .passthrough();
