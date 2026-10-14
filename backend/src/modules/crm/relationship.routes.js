import { Router } from 'express';
import { z } from 'zod';
import { ownStore, storeIdParams, uuid, respond, respondPage, pageQuery } from '../../lib/merchantRoute.js';
import { emptyBody } from '../../lib/schemas.js';
import * as crm from './crm.service.js';
import * as loyalty from '../loyalty/loyalty.service.js';
import * as offers from '../offers/offer.service.js';

/**
 * The merchant's relationship tools (roadmap §4 P2 CRM, P3 Loyalty, Phase C
 * local offers; §5 P4 coupons). Mounted at /merchant/stores.
 */
export const relationshipRouter = Router();

const customerParams = storeIdParams({ customerId: uuid('customer') });

// ── CRM ─────────────────────────────────────────────────────────────────────

relationshipRouter.get(
  '/:storeId/customers',
  ...ownStore({
    query: pageQuery(
      {
        segment: z.enum(['prospect', 'new', 'active', 'loyal', 'inactive']).optional(),
        search: z.string().trim().min(1).max(100).optional(),
        sort: z.enum(['last_order', 'total_spend', 'orders', 'name']).default('last_order'),
      },
      { maxLimit: 100 },
    ),
  }),
  respondPage(async (req) => {
    const { customers, total, segments, rules } = await crm.listCustomers(req.store, req.query);
    return { data: { customers, segments, rules }, total };
  }),
);

relationshipRouter.get(
  '/:storeId/customers/:customerId',
  ...ownStore({ params: customerParams }),
  respond(async (req) => ({ customer: await crm.getCustomer(req.store, req.params.customerId) })),
);

relationshipRouter.patch(
  '/:storeId/customers/:customerId',
  ...ownStore({
    params: customerParams,
    body: z
      .object({
        notes: z.string().trim().max(1000).nullable().optional(),
        tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
      })
      .strict(),
  }),
  respond(async (req) => ({ customer: await crm.saveNotes(req.store, req.params.customerId, req.body) })),
);

// ── Loyalty ─────────────────────────────────────────────────────────────────

relationshipRouter.get('/:storeId/loyalty', ...ownStore(), respond(async (req) => ({ program: await loyalty.getProgram(req.store) })));

relationshipRouter.put(
  '/:storeId/loyalty',
  ...ownStore({
    body: z
      .object({
        isActive: z.boolean().optional(),
        earnPointsPer100: z.number().int().min(0).max(1000).optional(),
        pointValuePaise: z.number().int().min(1).max(100000).optional(),
        minOrderPaiseToEarn: z.number().int().min(0).max(100_000_000).optional(),
        minRedeemPoints: z.number().int().min(0).max(1_000_000).optional(),
        maxRedeemPercent: z.number().int().min(0).max(100).optional(),
        welcomeBonusPoints: z.number().int().min(0).max(100000).optional(),
        pointsExpireDays: z.number().int().min(30).max(3650).nullable().optional(),
      })
      .strict(),
  }),
  respond(async (req) => ({ program: await loyalty.saveProgram(req.store, req.body) })),
);

const rewardFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  pointsCost: z.number().int().min(1).max(1_000_000),
  discountType: z.enum(['flat', 'percent', 'free_delivery']),
  percentOff: z.number().int().min(1).max(100).optional(),
  amountOffPaise: z.number().int().min(1).max(100_000_000).optional(),
  isActive: z.boolean().optional(),
};

relationshipRouter.get('/:storeId/loyalty/rewards', ...ownStore(), respond(async (req) => ({ rewards: await loyalty.listRewards(req.store.id) })));
relationshipRouter.post(
  '/:storeId/loyalty/rewards',
  ...ownStore({ body: z.object(rewardFields).strict(), write: true }),
  respond(async (req) => ({ reward: await loyalty.createReward(req.store, req.body) }), { created: true }),
);
relationshipRouter.patch(
  '/:storeId/loyalty/rewards/:rewardId',
  ...ownStore({
    params: storeIdParams({ rewardId: uuid('reward') }),
    body: z.object(Object.fromEntries(Object.entries(rewardFields).map(([key, schema]) => [key, schema.optional()]))).strict(),
  }),
  respond(async (req) => ({ reward: await loyalty.updateReward(req.store, req.params.rewardId, req.body) })),
);

relationshipRouter.get(
  '/:storeId/loyalty/members',
  ...ownStore({ query: pageQuery({}, { maxLimit: 100 }) }),
  respondPage(async (req) => {
    const { members, total } = await loyalty.listMembers(req.store, req.query);
    return { data: { members }, total };
  }),
);

relationshipRouter.get(
  '/:storeId/customers/:customerId/points',
  ...ownStore({ params: customerParams }),
  respond(async (req) => ({ history: await loyalty.ledgerFor(req.store.id, req.params.customerId) })),
);

relationshipRouter.post(
  '/:storeId/customers/:customerId/points',
  ...ownStore({
    params: customerParams,
    body: z
      .object({
        points: z.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, 'Use a non-zero number of points.'),
        reason: z.string().trim().min(3, 'Say why (3 characters or more).').max(300),
      })
      .strict(),
    write: true,
  }),
  respond(async (req) => loyalty.adjustPoints(req.store, req.merchant, req.params.customerId, req.body), { created: true }),
);

// ── Coupons ─────────────────────────────────────────────────────────────────

const couponFields = {
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,30}$/, 'Use 3–30 letters, digits, - or _.'),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  discountType: z.enum(['percent', 'flat', 'free_delivery']),
  percentOff: z.number().int().min(1).max(100).optional(),
  amountOffPaise: z.number().int().min(1).max(100_000_000).optional(),
  maxDiscountPaise: z.number().int().min(1).max(100_000_000).nullable().optional(),
  minOrderPaise: z.number().int().min(0).max(100_000_000).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
  maxUsesPerCustomer: z.number().int().min(1).max(1000).optional(),
  audience: z.enum(['all', 'new', 'returning', 'loyal', 'followers', 'birthday']).optional(),
  stackableWithLoyalty: z.boolean().optional(),
  isActive: z.boolean().optional(),
};

const discountShape = (v) =>
  v.discountType === undefined ||
  (v.discountType === 'percent' && v.percentOff) ||
  (v.discountType === 'flat' && v.amountOffPaise) ||
  v.discountType === 'free_delivery';

relationshipRouter.get('/:storeId/coupons', ...ownStore(), respond(async (req) => ({ coupons: await offers.listCoupons(req.store) })));
relationshipRouter.post(
  '/:storeId/coupons',
  ...ownStore({
    body: z.object(couponFields).strict().refine(discountShape, { message: 'Give percentOff for a percent coupon, amountOffPaise for a flat one.', path: ['discountType'] }),
    write: true,
  }),
  respond(async (req) => ({ coupon: await offers.createCoupon(req.store, req.body) }), { created: true }),
);
relationshipRouter.patch(
  '/:storeId/coupons/:couponId',
  ...ownStore({
    params: storeIdParams({ couponId: uuid('coupon') }),
    body: z
      .object(Object.fromEntries(Object.entries(couponFields).map(([key, schema]) => [key, schema.optional()])))
      .strict()
      .refine(discountShape, { message: 'Give percentOff for a percent coupon, amountOffPaise for a flat one.', path: ['discountType'] }),
  }),
  respond(async (req) => ({ coupon: await offers.updateCoupon(req.store, req.params.couponId, req.body) })),
);

// ── Local offers ────────────────────────────────────────────────────────────

relationshipRouter.get(
  '/:storeId/offers',
  ...ownStore({ query: z.object({ status: z.enum(['all', 'live', 'scheduled', 'ended']).default('all') }).strict() }),
  respond(async (req) => ({ offers: await offers.listStoreOffers(req.store, req.query) })),
);

relationshipRouter.post(
  '/:storeId/offers',
  ...ownStore({
    body: z
      .object({
        kind: z.enum(['expiry', 'promotion']).default('expiry'),
        variantId: uuid('variant'),
        batchId: uuid('batch').optional(),
        title: z.string().trim().min(1).max(80),
        description: z.string().trim().max(300).optional(),
        offerPricePaise: z.number().int().min(0).max(100_000_000),
        startsAt: z.string().datetime({ offset: true }).optional(),
        endsAt: z.string().datetime({ offset: true }),
        quantityLimit: z.number().int().min(1).max(100_000).optional(),
        radiusKm: z.number().positive().max(50).optional(),
        expiryCutoffDays: z.number().int().min(0).max(365).optional(),
      })
      .strict()
      .refine((v) => !v.startsAt || new Date(v.startsAt) < new Date(v.endsAt), { message: 'The offer must end after it starts.', path: ['endsAt'] }),
    write: true,
  }),
  respond(async (req) => ({ offer: await offers.createOffer(req.store, req.merchant, req.body) }), { created: true }),
);

relationshipRouter.post(
  '/:storeId/offers/:offerId/end',
  ...ownStore({ params: storeIdParams({ offerId: uuid('offer') }), body: emptyBody }),
  respond(async (req) => ({ offer: await offers.endOffer(req.store, req.params.offerId) })),
);
