import { Router } from 'express';
import { z } from 'zod';
import { ownStore, respond, storeIdParams, uuid } from '../../lib/merchantRoute.js';
import { validate } from '../../middleware/validate.js';
import { optionalAuth, requireCustomer } from '../../middleware/requireAuth.js';
import * as merchant from './merchantIntelligence.service.js';
import * as customer from './customerIntelligence.service.js';

/**
 * Merchant intelligence (roadmap §4 Phase D/E), under /merchant/stores. All
 * read-only: the POSTs carry text to read, not changes to make.
 */
export const merchantIntelligenceRouter = Router();

const text = (max) => z.string().trim().min(1, 'Write something first.').max(max);

merchantIntelligenceRouter.get(
  '/:storeId/intelligence/stock',
  ...ownStore({
    query: z
      .object({
        horizonDays: z.coerce.number().int().min(1).max(60).default(14),
        leadDays: z.coerce.number().int().min(1).max(60).default(7),
      })
      .strict(),
  }),
  respond(async (req) => ({ stock: await merchant.demandAndStock(req.store, req.query) })),
);

merchantIntelligenceRouter.post(
  '/:storeId/intelligence/product-suggestions',
  ...ownStore({ body: z.object({ name: text(200) }).strict() }),
  respond(async (req) => ({ suggestion: await merchant.suggestForProduct(req.store, req.body) })),
);

merchantIntelligenceRouter.post(
  '/:storeId/intelligence/invoice',
  ...ownStore({ body: z.object({ text: text(20_000) }).strict() }),
  respond(async (req) => ({ invoice: await merchant.extractInvoice(req.store, req.body) })),
);

merchantIntelligenceRouter.post(
  '/:storeId/intelligence/command',
  ...ownStore({ body: z.object({ text: text(300) }).strict() }),
  respond(async (req) => ({ command: await merchant.proposeCommand(req.store, req.body) })),
);

merchantIntelligenceRouter.post(
  '/:storeId/intelligence/ask',
  ...ownStore({ body: z.object({ question: text(500) }).strict() }),
  respond(async (req) => ({ reply: await merchant.askAssistant(req.store, req.body) })),
);

merchantIntelligenceRouter.get(
  '/:storeId/intelligence/area',
  ...ownStore(),
  respond(async (req) => ({ area: await merchant.areaInsights(req.store) })),
);

// ── Customer (roadmap §5 P6, Phase E) ───────────────────────────────────────

/** Under /stores: public reads that personalise when signed in, and the basket proposal. */
export const customerIntelligenceRouter = Router();
/** Under /me: the signed-in customer's own predictions. */
export const meIntelligenceRouter = Router();

const slug = z.string().trim().min(1).max(60).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/i, 'Not a valid store link.');
const slugParams = z.object({ slug }).strict();
const slugProductParams = z.object({ slug, productId: uuid('product') }).strict();

customerIntelligenceRouter.get(
  '/:slug/smart-search',
  optionalAuth,
  validate({ params: slugParams, query: z.object({ q: text(200) }).strict() }),
  respond(async (req) => ({ search: await customer.smartSearch(req.params.slug, req.query) })),
);

customerIntelligenceRouter.post(
  '/:slug/assistant',
  optionalAuth,
  validate({ params: slugParams, body: z.object({ message: text(500) }).strict() }),
  respond(async (req) => ({ reply: await customer.shopAssistant(req.params.slug, req.customer?.id ?? null, req.body) })),
);

customerIntelligenceRouter.get(
  '/:slug/products/:productId/recommendations',
  validate({ params: slugProductParams }),
  respond(async (req) => ({ recommendations: await customer.recommendations(req.params.slug, req.params.productId) })),
);

customerIntelligenceRouter.get(
  '/:slug/products/:productId/alternatives',
  validate({ params: slugProductParams }),
  respond(async (req) => ({ alternatives: await customer.alternatives(req.params.slug, req.params.productId) })),
);

customerIntelligenceRouter.post(
  '/:storeId/basket/propose',
  ...requireCustomer,
  validate({ params: z.object({ storeId: uuid('store') }).strict(), body: z.object({ text: text(2000) }).strict() }),
  respond(async (req) => ({ basket: await customer.proposeBasket(req.customer.id, req.params.storeId, req.body) })),
);

meIntelligenceRouter.get('/replenishment', ...requireCustomer, respond(async (req) => ({ replenishment: await customer.replenishment(req.customer.id) })));

meIntelligenceRouter.get(
  '/discover',
  ...requireCustomer,
  validate({ query: z.object({ storeId: uuid('store') }).strict() }),
  respond(async (req) => ({ discover: await customer.discover(req.customer.id, req.query.storeId) })),
);

// The merchant picking a replacement for a customer's item uses the same engine.
merchantIntelligenceRouter.get(
  '/:storeId/products/:productId/alternatives',
  ...ownStore({ params: storeIdParams({ productId: uuid('product') }) }),
  respond(async (req) => ({ alternatives: await customer.alternativesFor(req.store.id, req.params.productId) })),
);
