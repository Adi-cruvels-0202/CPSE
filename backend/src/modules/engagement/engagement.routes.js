import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireCustomer, optionalAuth } from '../../middleware/requireAuth.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { respond } from '../../lib/merchantRoute.js';
import { emptyBody } from '../../lib/schemas.js';
import * as engagement from './engagement.service.js';
import * as loyalty from '../loyalty/loyalty.service.js';
import * as offers from '../offers/offer.service.js';

/**
 * The customer's own engagement endpoints (roadmap §5 P2–P6), the public
 * offer endpoints, and store-scoped loyalty for the customer. Everything under
 * /me is the signed-in customer's; the offer reads are public.
 */
export const meRouter = Router();
export const customerStoreRouter = Router();
export const publicOfferRouter = Router();

const uuid = (what) => z.string().uuid(`Not a valid ${what}.`);
const storeQuery = z.object({ storeId: uuid('store').optional() }).strict();

// ── Preferences and consent ─────────────────────────────────────────────────

meRouter.get('/preferences', ...requireCustomer, respond(async (req) => ({ preferences: await engagement.getPreferences(req.customer.id) })));

meRouter.patch(
  '/preferences',
  ...requireCustomer,
  validate({
    body: z
      .object({
        birthday: z
          .object({ month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) })
          .strict()
          .nullable()
          .optional(),
        activityTracking: z.boolean().optional(),
        occasionOffers: z.boolean().optional(),
        preferredFulfilment: z.enum(['pickup', 'delivery']).nullable().optional(),
        preferredPaymentMethod: z.enum(['cash', 'online', 'khata']).nullable().optional(),
        preferredSubstitution: z.enum(['contact_me', 'allow_similar', 'no_substitutions']).optional(),
        preferredLanguage: z.string().trim().min(2).max(10).nullable().optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one preference.' }),
  }),
  respond(async (req) => ({ preferences: await engagement.updatePreferences(req.customer.id, req.body) })),
);

meRouter.get('/store-preferences', ...requireCustomer, respond(async (req) => ({ stores: await engagement.listStorePreferences(req.customer.id) })));

const storeParams = z.object({ storeId: uuid('store') }).strict();

customerStoreRouter.get(
  '/:storeId/preferences',
  ...requireCustomer,
  validate({ params: storeParams }),
  respond(async (req) => ({ preferences: await engagement.getStorePreferences(req.customer.id, req.params.storeId) })),
);

customerStoreRouter.put(
  '/:storeId/preferences',
  ...requireCustomer,
  validate({
    params: storeParams,
    body: z
      .object({
        allowPromotions: z.boolean().optional(),
        allowReminders: z.boolean().optional(),
        allowSms: z.boolean().optional(),
        allowWhatsapp: z.boolean().optional(),
        allowEmail: z.boolean().optional(),
      })
      .strict(),
  }),
  respond(async (req) => ({ preferences: await engagement.setStorePreferences(req.customer.id, req.params.storeId, req.body) })),
);

// ── Activity ────────────────────────────────────────────────────────────────

meRouter.post(
  '/events',
  ...requireCustomer,
  validate({
    body: z
      .object({
        eventType: z.enum(['store_view', 'product_view', 'search', 'cart_add', 'cart_remove', 'checkout_start', 'offer_view']),
        storeId: uuid('store').optional(),
        productId: uuid('product').optional(),
        variantId: uuid('variant').optional(),
        query: z.string().trim().min(1).max(200).optional(),
        sessionId: z.string().trim().min(1).max(100).optional(),
      })
      .strict(),
  }),
  respond(async (req) => engagement.recordEvent(req.customer.id, req.body)),
);

meRouter.get(
  '/recently-viewed',
  ...requireCustomer,
  validate({ query: storeQuery }),
  respond(async (req) => ({ products: await engagement.recentlyViewed(req.customer.id, req.query) })),
);
meRouter.get(
  '/recently-purchased',
  ...requireCustomer,
  validate({ query: storeQuery }),
  respond(async (req) => ({ products: await engagement.recentlyPurchased(req.customer.id, req.query) })),
);
meRouter.get(
  '/buy-again',
  ...requireCustomer,
  validate({ query: storeQuery }),
  respond(async (req) => ({ products: await engagement.buyAgain(req.customer.id, req.query) })),
);
meRouter.get(
  '/smart-cart',
  ...requireCustomer,
  validate({ query: z.object({ storeId: uuid('store') }).strict() }),
  respond(async (req) => ({ smartCart: await engagement.smartCart(req.customer.id, req.query.storeId) })),
);
meRouter.post(
  '/smart-cart/add',
  writeLimiter,
  ...requireCustomer,
  validate({ body: z.object({ storeId: uuid('store'), onlyMissing: z.boolean().default(true) }).strict() }),
  respond(async (req) => engagement.addUsualToCart(req.customer.id, req.body.storeId, req.body)),
);
meRouter.get('/insights', ...requireCustomer, respond(async (req) => ({ insights: await engagement.insights(req.customer.id) })));

// ── Favourites ──────────────────────────────────────────────────────────────

const productParams = z.object({ productId: uuid('product') }).strict();
meRouter.get('/favourites', ...requireCustomer, validate({ query: storeQuery }), respond(async (req) => ({ products: await engagement.listFavourites(req.customer.id, req.query) })));
meRouter.post('/favourites/:productId', ...requireCustomer, validate({ params: productParams, body: emptyBody }), respond(async (req) => engagement.addFavourite(req.customer.id, req.params.productId)));
meRouter.delete('/favourites/:productId', ...requireCustomer, validate({ params: productParams }), respond(async (req) => engagement.removeFavourite(req.customer.id, req.params.productId)));

// ── Shopping lists and templates ────────────────────────────────────────────

const listParams = z.object({ listId: uuid('list') }).strict();
const itemParams = z.object({ listId: uuid('list'), itemId: uuid('list item') }).strict();
const listItem = z
  .object({
    productId: uuid('product').optional(),
    variantId: uuid('variant').optional(),
    label: z.string().trim().min(1).max(120).optional(),
    quantity: z.number().int().min(1).max(999).default(1),
    note: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((v) => v.productId || v.label, { message: 'Name a product or write what to buy.', path: ['label'] });

meRouter.get(
  '/lists',
  ...requireCustomer,
  validate({ query: z.object({ kind: z.enum(['list', 'template']).optional() }).strict() }),
  respond(async (req) => ({ lists: await engagement.listLists(req.customer.id, req.query) })),
);
meRouter.post(
  '/lists',
  ...requireCustomer,
  validate({
    body: z
      .object({
        name: z.string().trim().min(1).max(80),
        kind: z.enum(['list', 'template']).default('list'),
        storeId: uuid('store').optional(),
        repeatEveryDays: z.number().int().min(1).max(90).optional(),
        items: z.array(listItem).max(100).optional(),
      })
      .strict()
      .refine((v) => v.kind === 'list' || v.storeId, { message: 'A template belongs to one store.', path: ['storeId'] }),
  }),
  respond(async (req) => ({ list: await engagement.createList(req.customer.id, req.body) }), { created: true }),
);
meRouter.get('/lists/:listId', ...requireCustomer, validate({ params: listParams }), respond(async (req) => ({ list: await engagement.getList(req.customer.id, req.params.listId) })));
meRouter.patch(
  '/lists/:listId',
  ...requireCustomer,
  validate({
    params: listParams,
    body: z.object({ name: z.string().trim().min(1).max(80).optional(), repeatEveryDays: z.number().int().min(1).max(90).nullable().optional() }).strict(),
  }),
  respond(async (req) => ({ list: await engagement.updateList(req.customer.id, req.params.listId, req.body) })),
);
meRouter.delete(
  '/lists/:listId',
  ...requireCustomer,
  validate({ params: listParams }),
  respond(async (req) => {
    await engagement.deleteList(req.customer.id, req.params.listId);
    return { deleted: true };
  }),
);
meRouter.post(
  '/lists/:listId/items',
  ...requireCustomer,
  validate({ params: listParams, body: listItem }),
  respond(async (req) => ({ list: await engagement.addListItem(req.customer.id, req.params.listId, req.body) }), { created: true }),
);
meRouter.patch(
  '/lists/:listId/items/:itemId',
  ...requireCustomer,
  validate({
    params: itemParams,
    body: z.object({ quantity: z.number().int().min(1).max(999).optional(), note: z.string().trim().max(200).nullable().optional(), isChecked: z.boolean().optional() }).strict(),
  }),
  respond(async (req) => ({ list: await engagement.updateListItem(req.customer.id, req.params.listId, req.params.itemId, req.body) })),
);
meRouter.delete(
  '/lists/:listId/items/:itemId',
  ...requireCustomer,
  validate({ params: itemParams }),
  respond(async (req) => ({ list: await engagement.removeListItem(req.customer.id, req.params.listId, req.params.itemId) })),
);
meRouter.post(
  '/lists/:listId/add-to-cart',
  writeLimiter,
  ...requireCustomer,
  validate({ params: listParams, body: z.object({ storeId: uuid('store').optional() }).strict() }),
  respond(async (req) => engagement.addListToCart(req.customer.id, req.params.listId, req.body)),
);

// ── Loyalty (customer) ──────────────────────────────────────────────────────

meRouter.get('/loyalty', ...requireCustomer, respond(async (req) => ({ accounts: await loyalty.myLoyaltyAccounts(req.customer.id) })));

customerStoreRouter.get(
  '/:storeId/loyalty',
  ...requireCustomer,
  validate({ params: storeParams }),
  respond(async (req) => ({ loyalty: await loyalty.myLoyalty(req.customer.id, req.params.storeId) })),
);

customerStoreRouter.post(
  '/:storeId/loyalty/rewards/:rewardId/redeem',
  writeLimiter,
  ...requireCustomer,
  validate({ params: z.object({ storeId: uuid('store'), rewardId: uuid('reward') }).strict(), body: emptyBody }),
  respond(async (req) => loyalty.redeemReward(req.customer.id, req.params.storeId, req.params.rewardId), { created: true }),
);

// ── Offers (public) ─────────────────────────────────────────────────────────

publicOfferRouter.get(
  '/nearby',
  validate({
    query: z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .strict(),
  }),
  respond(async (req) => ({ offers: await offers.nearbyOffers({ latitude: req.query.lat, longitude: req.query.lng, limit: req.query.limit }) })),
);

export const storeOffersHandler = [
  optionalAuth,
  validate({ params: z.object({ slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/i, 'Not a valid store link.') }).strict() }),
  respond(async (req) => offers.storeOffersPublic(req.params.slug, req.customer?.id ?? null)),
];
