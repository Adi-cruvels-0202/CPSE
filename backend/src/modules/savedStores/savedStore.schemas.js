import { z } from 'zod';

/**
 * Checklist 9.1. A store is addressed by its uuid here, not its slug.
 *
 * The public storefront is slug-keyed because that is what a shared link
 * carries (D22); every authenticated write — cart, checkout, orders — takes a
 * `storeId` uuid. Saving is an authenticated write, so it follows that side of
 * the convention, and the store page returns the id the client needs.
 */
export const savedStoreParams = z
  .object({ storeId: z.string().uuid('Not a valid store.') })
  .strict();

export const savedStoreListQuery = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();
