import { z } from 'zod';

/**
 * Request shapes for the merchant account endpoints (MERCHANT_API.md, Merchant
 * account). The same field rules as the customer side — one login system, so
 * one set of limits — and `.strict()` throughout (D20).
 */

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be at most 72 characters.');

const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254);

// Matches the merchants_phone_format CHECK (migration 0024).
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, 'Enter a valid phone number.');

const fullName = z.string().trim().min(1, 'Enter your name.').max(120);

/** A shopkeeper signing up: unlike a customer, the name is required. */
export const registerMerchantSchema = z
  .object({
    email,
    password,
    fullName,
    phone: phone.optional(),
  })
  .strict();

/**
 * An existing signed-in account becoming a merchant. Both fields optional:
 * anything left out is taken from the customer profile.
 */
export const onboardMerchantSchema = z
  .object({
    fullName: fullName.optional(),
    phone: phone.optional(),
  })
  .strict();

export const updateMerchantSchema = z
  .object({
    fullName: fullName.optional(),
    // null clears it; leaving it out leaves it alone.
    phone: phone.nullable().optional(),
  })
  // Email and id are not editable here, and are refused rather than ignored.
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });
