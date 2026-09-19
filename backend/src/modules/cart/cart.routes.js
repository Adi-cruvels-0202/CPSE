import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import * as controller from './cart.controller.js';
import {
  cartQuery,
  cartItemParams,
  addCartItemSchema,
  updateCartItemSchema,
  validateCartSchema,
} from './cart.schemas.js';

/** A cart always belongs to somebody, so the whole router is authenticated. */
export const cartRouter = Router();

cartRouter.use(requireAuth);

cartRouter.get('/', validate({ query: cartQuery }), controller.getCart);
cartRouter.delete('/', validate({ query: cartQuery }), controller.clearCart);

cartRouter.post('/items', validate({ body: addCartItemSchema }), controller.addItem);
cartRouter.patch(
  '/items/:itemId',
  validate({ params: cartItemParams, body: updateCartItemSchema }),
  controller.updateItem,
);
cartRouter.delete('/items/:itemId', validate({ params: cartItemParams }), controller.removeItem);

cartRouter.post('/validate', validate({ body: validateCartSchema }), controller.validateCart);
