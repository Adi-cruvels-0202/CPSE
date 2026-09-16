import { z } from 'zod';

/**
 * Request shapes for every auth endpoint. Spec §16: validated server-side, and
 * `.strict()` everywhere so a client that sends an unexpected field (say,
 * `role`) is told rather than having it silently dropped.
 */

// Supabase enforces a minimum of 6 by default; 8 is our floor. The upper bound
// exists because bcrypt-style hashing truncates very long inputs.
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be at most 72 characters.');

const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254);

// E.164-ish, matching the addresses/customers CHECK constraints in the schema.
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, 'Enter a valid phone number.');

const fullName = z.string().trim().min(1).max(120);

export const registerSchema = z
  .object({
    email,
    password,
    fullName: fullName.optional(),
    phone: phone.optional(),
  })
  .strict();

export const loginSchema = z.object({ email, password }).strict();

export const refreshSchema = z
  .object({ refreshToken: z.string().min(1, 'A refresh token is required.') })
  .strict();

export const forgotPasswordSchema = z.object({ email }).strict();

export const resetPasswordSchema = z
  .object({
    // The one-time access token from the emailed recovery link.
    accessToken: z.string().min(1, 'A recovery token is required.'),
    password,
  })
  .strict();

export const updateProfileSchema = z
  .object({
    // `.nullable()` lets a customer clear an optional field; omitting it leaves
    // the stored value alone.
    fullName: fullName.optional(),
    phone: phone.nullable().optional(),
    avatarUrl: z.string().trim().url('Enter a valid URL.').max(2048).nullable().optional(),
  })
  // Rejects `email` and `id` outright (checklist 2.9: both are immutable)
  // instead of accepting the request and quietly ignoring them.
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });
