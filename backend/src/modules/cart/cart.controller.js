import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, sendCreated } from '../../lib/response.js';
import * as cartService from './cart.service.js';

/**
 * The customer id always comes from the verified JWT (requireAuth), never from
 * the request — there is no way for a client to name someone else's cart.
 */

/** Checklist 5.1 */
export const getCart = asyncHandler(async (req, res) => {
  sendSuccess(res, { cart: await cartService.getCart(req.customer.id, req.query.storeId) });
});

/** Checklist 5.2 */
export const addItem = asyncHandler(async (req, res) => {
  sendCreated(res, { cart: await cartService.addItem(req.customer.id, req.body) });
});

/** Checklist 5.3 */
export const updateItem = asyncHandler(async (req, res) => {
  const cart = await cartService.updateItem(req.customer.id, req.params.itemId, req.body.quantity);
  sendSuccess(res, { cart });
});

/** Checklist 5.4 */
export const removeItem = asyncHandler(async (req, res) => {
  sendSuccess(res, { cart: await cartService.removeItem(req.customer.id, req.params.itemId) });
});

/** Checklist 5.5 */
export const clearCart = asyncHandler(async (req, res) => {
  sendSuccess(res, { cart: await cartService.clearCart(req.customer.id, req.query.storeId) });
});

/** Checklist 5.10 */
export const validateCart = asyncHandler(async (req, res) => {
  sendSuccess(res, { cart: await cartService.validateCart(req.customer.id, req.body) });
});
