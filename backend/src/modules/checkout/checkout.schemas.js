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

const groupShopSelection = z.object({
  storeId: z.string().uuid('Not a valid store.'),
  fulfilmentMode,
  couponCode: benefitFields.couponCode,
  redeemPoints: benefitFields.redeemPoints,
}).strict();

/** One shared address, with a fulfilment choice for each shop in the basket. */
export const checkoutGroupQuoteSchema = z.object({
  shops: z.array(groupShopSelection).min(2).max(30),
  addressId: z.string().uuid('Not a valid address.').nullish(),
}).strict().superRefine((value, ctx) => {
  const ids = value.shops.map((shop) => shop.storeId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['shops'], message: 'A shop can only appear once.' });
  if (value.shops.some((shop) => shop.fulfilmentMode === 'delivery') && !value.addressId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['addressId'], message: 'Choose a delivery address.' });
  }
});

export const createCheckoutGroupSchema = z.object({
  shops: z.array(groupShopSelection.extend({ expectedTotalPaise: z.number().int().nonnegative() }).strict()).min(2).max(30),
  addressId: z.string().uuid('Not a valid address.').nullish(),
  paymentMethod: z.literal('online'),
  customerNote: z.string().trim().max(500).nullish(),
  substitutionPreference: z.enum(['contact_me', 'allow_similar', 'no_substitutions']).nullish(),
  expectedTotalPaise: z.number().int().nonnegative(),
}).strict().superRefine((value, ctx) => {
  const ids = value.shops.map((shop) => shop.storeId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['shops'], message: 'A shop can only appear once.' });
  if (value.shops.some((shop) => shop.fulfilmentMode === 'delivery') && !value.addressId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['addressId'], message: 'Choose a delivery address.' });
  }
});
