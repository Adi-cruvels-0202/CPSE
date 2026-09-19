import { z } from 'zod';

/** The public store key is the slug, not the uuid — it is what a shared link carries. */
export const storeSlugParams = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Not a valid store link.'),
  })
  .strict();

export const productListQuery = z
  .object({
    categoryId: z.string().uuid('Not a valid category.').optional(),
    page: z.coerce.number().int().positive().default(1),
    // Capped so a shared link cannot be turned into a bulk catalogue export.
    limit: z.coerce.number().int().positive().max(100).default(20),
    // Off by default: the spec wants sold-out items visible but flagged.
    availableOnly: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .strict();

/** Phase 4. The product id is a uuid; the slug still scopes it to one store. */
export const storeProductParams = z
  .object({
    slug: storeSlugParams.shape.slug,
    productId: z.string().uuid('Not a valid product.'),
  })
  .strict();

/**
 * Checklist 4.3. Two characters is the floor — a one-character query matches
 * most of a catalogue and turns search into a full export.
 */
export const searchQuery = z
  .object({
    q: z
      .string()
      .trim()
      .min(2, 'Enter at least 2 characters to search.')
      .max(80, 'Search terms are limited to 80 characters.'),
    categoryId: z.string().uuid('Not a valid category.').optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();
