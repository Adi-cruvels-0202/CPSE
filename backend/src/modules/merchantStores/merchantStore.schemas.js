import { z } from 'zod';
import { toMinutes } from '../../lib/openingHours.js';

/**
 * Request shapes for a merchant's stores — MERCHANT_API.md, Stores. Limits
 * follow MERCHANT_RULES S-2 (Merchant-One's) where they are tighter than the
 * database's, and every shape is `.strict()` (D20).
 */

export const SHOP_CATEGORIES = [
  'grocery', 'pharmacy', 'restaurant', 'bakery', 'electronics', 'clothing', 'general', 'other',
];

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const text = (max) => z.string().trim().min(1).max(max);

/** Same grammar as stores_slug_format, kept short enough to read out loud. */
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Use at least 2 characters.')
  .max(60, 'Use at most 60 characters.')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and single hyphens.');

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, 'Enter a valid phone number.');

/** A zone Intl does not know would make every open/closed answer wrong. */
export function isValidTimezone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const timezone = z
  .string()
  .trim()
  .max(64)
  .refine(isValidTimezone, 'Not a recognised time zone, e.g. Asia/Kolkata.');

/** The store's address — the shape CPSE stores it in (MERGE_MAPPING §4.1). */
const address = z
  .object({
    line1: text(200),
    line2: z.string().trim().max(200).nullish(),
    city: text(100),
    state: z.string().trim().max(100).nullish(),
    postalCode: z
      .string()
      .trim()
      .min(3, 'Enter a valid postal code.')
      .max(12, 'Enter a valid postal code.')
      .regex(/^[A-Za-z0-9 -]+$/, 'Enter a valid postal code.')
      .nullish(),
    country: z.string().trim().toUpperCase().length(2, 'Use a two-letter country code.').default('IN'),
  })
  .strict();

const storeFields = {
  name: z.string().trim().min(2, 'Use at least 2 characters.').max(100),
  description: z.string().trim().max(1000).nullish(),
  shopCategory: z.enum(SHOP_CATEGORIES).nullish(),
  phone: phone.nullish(),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254).nullish(),
  // null clears the whole address.
  address: address.nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  timezone: timezone.optional(),
};

export const createStoreSchema = z.object({ ...storeFields, slug: slug.optional() }).strict();

export const updateStoreSchema = z
  .object({
    ...storeFields,
    name: storeFields.name.optional(),
    slug: slug.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update.' });

const time = z
  .string()
  .refine((value) => toMinutes(value) !== null, 'Use 24-hour HH:MM, e.g. 09:00.');

/**
 * One opening window. close < open runs past midnight (D-8); open = close is
 * not a window at all.
 */
const window = z
  .object({ open: time, close: time })
  .strict()
  .refine((value) => toMinutes(value.open) !== toMinutes(value.close), {
    message: 'A window cannot open and close at the same time.',
  });

/** All seven days, each up to three windows; [] is a closed day. */
export const openingHoursSchema = z
  .object(Object.fromEntries(DAYS.map((day) => [day, z.array(window).max(3, 'At most 3 windows a day.')])))
  .strict();

export const hoursSchema = z
  .object({ timezone: timezone.default('Asia/Kolkata'), openingHours: openingHoursSchema })
  .strict();

const paise = (max) => z.number().int('Use whole paise.').min(0).max(max);

export const deliverySchema = z
  .object({
    pickupEnabled: z.boolean(),
    deliveryEnabled: z.boolean(),
    deliveryFeePaise: paise(1_000_000),
    minOrderPaise: paise(100_000_000),
    // null = delivery is never free; null radius = no limit.
    freeDeliveryThresholdPaise: paise(100_000_000).nullable().default(null),
    deliveryRadiusKm: z.number().positive().max(1000).nullable().default(null),
  })
  .strict()
  // stores_one_mode_enabled: a store taking neither could never get an order.
  .refine((value) => value.pickupEnabled || value.deliveryEnabled, {
    message: 'Offer at least one of pickup or delivery.',
    path: ['pickupEnabled'],
  });

export const paymentsSchema = z
  .object({ cash: z.boolean(), online: z.boolean() })
  .strict()
  // stores_one_payment_method
  .refine((value) => value.cash || value.online, {
    message: 'Take at least one of cash or online payment.',
    path: ['cash'],
  });

export const storeParams = z.object({ storeId: z.string().uuid('Not a valid store.') }).strict();

// ── Holidays (P1, MERCHANT_RULES S-12) ──────────────────────────────────────

export const holidayParams = z
  .object({ storeId: z.string().uuid('Not a valid store.'), holidayId: z.string().uuid('Not a valid holiday.') })
  .strict();

export const holidaySchema = z
  .object({
    // A calendar date in the store's own timezone.
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
      .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), 'Not a real date.'),
    reason: z.string().trim().min(1).max(200).nullish(),
  })
  .strict();
