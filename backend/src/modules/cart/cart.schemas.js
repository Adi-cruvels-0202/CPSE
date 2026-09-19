import { z } from 'zod';

/**
 * Checklist 5.8. Quantity is validated here before it reaches a query: an
 * integer, at least 1, and no more than the cart_items_quantity_sane CHECK
 * allows (999). The stock ceiling is enforced in the service, because it needs
 * the product row.
 */
export const MAX_QUANTITY = 999;

const quantity = z
  .number({ invalid_type_error: 'Quantity must be a whole number.' })
  .int('Quantity must be a whole number.')
  .min(1, 'Quantity must be at least 1.')
  .max(MAX_QUANTITY, `Quantity must be at most ${MAX_QUANTITY}.`);

const storeId = z.string().uuid('Not a valid store.');

/** The cart is store-scoped (checklist 5.6), so every read names its store. */
export const cartQuery = z.object({ storeId }).strict();

export const addCartItemSchema = z
  .object({
    storeId,
    productId: z.string().uuid('Not a valid product.'),
    // Omitted for a product with no variants; a null is the same as omitting it.
    variantId: z.string().uuid('Not a valid product variant.').nullish(),
    quantity: quantity.default(1),
  })
  .strict();

export const updateCartItemSchema = z.object({ quantity }).strict();

export const cartItemParams = z
  .object({ itemId: z.string().uuid('Not a valid cart item.') })
  .strict();

/**
 * Checklist 5.10. `items` is what the client currently believes it is being
 * charged. Sending it turns the call into a price-drift check as well as an
 * availability check; omitting it still validates availability.
 */
export const validateCartSchema = z
  .object({
    storeId,
    items: z
      .array(
        z
          .object({
            itemId: z.string().uuid('Not a valid cart item.'),
            unitPricePaise: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
  })
  .strict();
