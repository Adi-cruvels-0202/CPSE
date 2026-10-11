import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireCustomer } from '../../middleware/requireAuth.js';
import * as controller from './checkout.controller.js';
import { checkoutQuoteSchema } from './checkout.schemas.js';
import { z } from 'zod';
import { respond } from '../../lib/merchantRoute.js';
import { quickQuote } from './checkout.service.js';

export const checkoutRouter = Router();

checkoutRouter.use(requireCustomer);

// POST rather than GET: the body carries the chosen mode, address and note, and
// a quote is cheap to recompute but must never be cached.
checkoutRouter.post('/quote', validate({ body: checkoutQuoteSchema }), controller.quote);
checkoutRouter.post(
  '/quick',
  validate({ body: z.object({ storeId: z.string().uuid('Not a valid store.') }).strict() }),
  respond(async (req) => quickQuote(req.customer.id, req.body)),
);
