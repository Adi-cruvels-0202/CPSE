import { z } from 'zod';

export const fulfilmentMode = z.enum(['pickup', 'delivery'], {
  errorMap: () => ({ message: 'Choose either pickup or delivery.' }),
});

/** Coupons, points and the substitution choice — shared by the quote and the order. */
export const benefitFields = {
  couponCode: z.string().trim().regex(/^[A-Za-z0-9_-]{3,30}$/, 'Not a valid coupon code.').nullish(),
  redeemPoints: z.number().int().min(0).max(10_000_000).nullish(),
  substitutionPreference: z.enum(['contact_me', 'allow_similar', 'no_substitutions']).nullish(),
};

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
    ...benefitFields,
  })
  .strict();
