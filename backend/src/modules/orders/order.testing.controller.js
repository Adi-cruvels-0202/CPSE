import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess } from '../../lib/response.js';
import { notFound } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import * as orderService from './order.service.js';

/**
 * ⚠️  TEST-ONLY — checklist 8.8.
 *
 * The merchant dashboard is explicitly out of scope, but the customer-side
 * order lifecycle cannot be exercised without something moving an order from
 * 'placed' to 'accepted' to 'completed'. This endpoint is that something. It
 * stands in for a merchant action and does exactly what a merchant would be
 * allowed to do — no more: every move still goes through the state machine
 * (8.3), so it cannot manufacture an illegal transition either.
 *
 * It is mounted only when ENABLE_TEST_ENDPOINTS is true, and env.js refuses to
 * boot a production process with that flag set.
 */
export const advanceOrder = asyncHandler(async (req, res) => {
  if (!env.ENABLE_TEST_ENDPOINTS) throw notFound('Route');

  // The caller must still own the order, so this is not a way to read someone
  // else's — it is a stand-in for the merchant, not an admin backdoor.
  const row = await orderService.findOwnedOrder(req.customer.id, req.params.id);

  await orderService.transitionOrder(row, req.body.status, {
    changedBy: 'store',
    note: req.body.note ?? 'Advanced by the test-only merchant endpoint',
  });

  sendSuccess(res, {
    order: await orderService.getOrder(req.customer.id, req.params.id),
    warning: 'This endpoint is test-only and stands in for the merchant dashboard.',
  });
});
