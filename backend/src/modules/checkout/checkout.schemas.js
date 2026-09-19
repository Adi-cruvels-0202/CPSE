import { z } from 'zod';

export const fulfilmentMode = z.enum(['pickup', 'delivery'], {
  errorMap: () => ({ message: 'Choose either pickup or delivery.' }),
});

/**
 * Checklist 6.7. The quote is a pure read: it prices the current cart for one
 * fulfilment mode and one address, and changes nothing. The client may call it
 * as often as the customer flips between pickup and delivery.
 */
export const checkoutQuoteSchema = z
  .object({
    storeId: z.string().uuid('Not a valid store.'),
    fulfilmentMode,
    // Required for delivery; the service rejects it rather than the schema, so
    // the customer gets a fulfilment-shaped message instead of a field error.
    addressId: z.string().uuid('Not a valid address.').nullish(),
    customerNote: z.string().trim().max(500).nullish(),
  })
  .strict();
