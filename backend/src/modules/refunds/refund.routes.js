import { Router } from 'express';
import { z } from 'zod';
import { ownStore, storeIdParams, uuid, respond, respondPage, pageQuery } from '../../lib/merchantRoute.js';
import { emptyBody } from '../../lib/schemas.js';
import * as refunds from './refund.service.js';

/**
 * /merchant/stores/:storeId/refunds — the store's view of money owed back on
 * cancelled and rejected paid orders (roadmap §4 P2, §6 Cancellation & Refund).
 */
export const merchantRefundRouter = Router();

const refundParams = storeIdParams({ refundId: uuid('refund') });
const statuses = z
  .string()
  .trim()
  .transform((value) => value.split(',').map((part) => part.trim()).filter(Boolean))
  .pipe(z.array(z.enum(['initiated', 'processing', 'refunded', 'failed'])).min(1));

merchantRefundRouter.get(
  '/:storeId/refunds',
  ...ownStore({ query: pageQuery({ status: statuses.optional() }) }),
  respondPage(async (req) => {
    const { refunds: rows, total } = await refunds.listStoreRefunds(req.store, req.query);
    return { data: { refunds: rows }, total };
  }),
);

merchantRefundRouter.get(
  '/:storeId/refunds/:refundId',
  ...ownStore({ params: refundParams }),
  respond(async (req) => ({ refund: await refunds.getStoreRefund(req.store, req.params.refundId) })),
);

merchantRefundRouter.post(
  '/:storeId/refunds/:refundId/retry',
  ...ownStore({ params: refundParams, body: emptyBody, write: true }),
  respond(async (req) => ({ refund: await refunds.retryRefund(req.store, req.params.refundId) })),
);

merchantRefundRouter.post(
  '/:storeId/refunds/:refundId/confirm-cash',
  ...ownStore({
    params: refundParams,
    body: z.object({ note: z.string().trim().min(1).max(300).optional() }).strict(),
    write: true,
  }),
  respond(async (req) => ({ refund: await refunds.confirmCashRefund(req.store, req.params.refundId, req.body) })),
);
