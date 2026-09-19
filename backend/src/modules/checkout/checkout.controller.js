import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess } from '../../lib/response.js';
import * as checkoutService from './checkout.service.js';

/** Checklist 6.7 */
export const quote = asyncHandler(async (req, res) => {
  sendSuccess(res, { quote: await checkoutService.quoteCheckout(req.customer.id, req.body) });
});
