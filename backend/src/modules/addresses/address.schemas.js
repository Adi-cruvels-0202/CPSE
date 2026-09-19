import { z } from 'zod';

/**
 * Checklist 6.2. Structured fields, each one matched to the CHECK constraints
 * in migration 0009 — so a value the database would reject is refused here with
 * a field-level message instead of surfacing as a 500.
 */

const text = (max) => z.string().trim().min(1).max(max);

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, 'Enter a valid phone number.');

const baseAddress = {
  label: z.string().trim().max(40).nullish(),
  recipientName: text(120),
  phone,
  line1: text(200),
  line2: z.string().trim().max(200).nullish(),
  landmark: z.string().trim().max(200).nullish(),
  city: text(100),
  state: text(100),
  postalCode: z
    .string()
    .trim()
    .min(3, 'Enter a valid postal code.')
    .max(12, 'Enter a valid postal code.')
    .regex(/^[A-Za-z0-9 -]+$/, 'Enter a valid postal code.'),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .length(2, 'Use a two-letter country code.')
    .default('IN'),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  isDefault: z.boolean().default(false),
};

export const createAddressSchema = z.object(baseAddress).strict();

/**
 * Every field optional, but at least one required: an empty PATCH is a client
 * bug, and answering 200 to it would hide that.
 */
export const updateAddressSchema = z
  .object({
    ...baseAddress,
    recipientName: baseAddress.recipientName.optional(),
    phone: phone.optional(),
    line1: baseAddress.line1.optional(),
    city: baseAddress.city.optional(),
    state: baseAddress.state.optional(),
    postalCode: baseAddress.postalCode.optional(),
    country: z.string().trim().toUpperCase().length(2).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const addressParams = z
  .object({ id: z.string().uuid('Not a valid address.') })
  .strict();
