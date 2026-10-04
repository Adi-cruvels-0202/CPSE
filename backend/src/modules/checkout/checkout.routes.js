import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireCustomer } from '../../middleware/requireAuth.js';
import * as controller from './checkout.controller.js';
import { checkoutQuoteSchema } from './checkout.schemas.js';

export const checkoutRouter = Router();

checkoutRouter.use(requireCustomer);

// POST rather than GET: the body carries the chosen mode, address and note, and
// a quote is cheap to recompute but must never be cached.
checkoutRouter.post('/quote', validate({ body: checkoutQuoteSchema }), controller.quote);
