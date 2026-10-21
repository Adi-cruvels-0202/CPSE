import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireCustomer } from '../../middleware/requireAuth.js';
import { requirePermission } from '../../middleware/requireAdmin.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { ownStore, storeIdParams, uuid, respond } from '../../lib/merchantRoute.js';
import { emptyBody } from '../../lib/schemas.js';
import * as messaging from './messaging.service.js';
import * as announcements from './announcement.service.js';
import * as substitutions from '../substitutions/substitution.service.js';

/**
 * Conversations (roadmap §5 P3 ask the shop, special requests, order
 * messaging; P5 support and escalation), substitutions (P5) and store
 * announcements (P3). Three audiences, three routers.
 */
export const conversationRouter = Router(); // /conversations — the customer's
export const merchantMessagingRouter = Router(); // /merchant/stores/:storeId/…
export const adminSupportRouter = Router(); // /admin/support — escalated only
export const substitutionRouter = Router(); // /substitutions — the customer's answer

const body = z.string().trim().min(1, 'Write a message.').max(2000);
const conversationParams = z.object({ conversationId: uuid('conversation') }).strict();

// ── Customer ────────────────────────────────────────────────────────────────

conversationRouter.get(
  '/',
  ...requireCustomer,
  validate({ query: z.object({ orderId: uuid('order').optional() }).strict() }),
  respond(async (req) => ({ conversations: await messaging.listCustomerConversations(req.customer.id, req.query) })),
);

conversationRouter.post(
  '/',
  writeLimiter,
  ...requireCustomer,
  validate({
    body: z
      .object({
        kind: z.enum(['question', 'special_request', 'order', 'support']),
        storeId: uuid('store').optional(),
        orderId: uuid('order').optional(),
        productId: uuid('product').optional(),
        requestType: z.enum(['custom_item', 'packaging', 'delivery_time', 'bulk_order', 'other']).optional(),
        subject: z.string().trim().min(1).max(120),
        message: body,
      })
      .strict()
      .refine((v) => (['order', 'support'].includes(v.kind) ? Boolean(v.orderId) : Boolean(v.storeId || v.orderId)), {
        message: 'Say which store, or which of your orders, this is about.',
        path: ['storeId'],
      }),
  }),
  respond(async (req) => ({ conversation: await messaging.startConversation(req.customer.id, req.body) }), { created: true }),
);

conversationRouter.get(
  '/:conversationId',
  ...requireCustomer,
  validate({ params: conversationParams }),
  respond(async (req) => ({ conversation: await messaging.getCustomerConversation(req.customer.id, req.params.conversationId) })),
);

conversationRouter.post(
  '/:conversationId/messages',
  writeLimiter,
  ...requireCustomer,
  validate({ params: conversationParams, body: z.object({ body }).strict() }),
  respond(async (req) => ({ conversation: await messaging.customerReply(req.customer.id, req.params.conversationId, req.body.body) }), { created: true }),
);

conversationRouter.post(
  '/:conversationId/escalate',
  ...requireCustomer,
  validate({ params: conversationParams, body: z.object({ reason: z.string().trim().min(3).max(500) }).strict() }),
  respond(async (req) => ({ conversation: await messaging.escalate(req.customer.id, req.params.conversationId, req.body) })),
);

conversationRouter.post(
  '/:conversationId/resolve',
  ...requireCustomer,
  validate({ params: conversationParams, body: emptyBody }),
  respond(async (req) => ({ conversation: await messaging.resolveByCustomer(req.customer.id, req.params.conversationId) })),
);

substitutionRouter.post(
  '/:substitutionId/respond',
  ...requireCustomer,
  validate({
    params: z.object({ substitutionId: uuid('substitution') }).strict(),
    body: z.object({ approve: z.boolean(), note: z.string().trim().min(1).max(300).optional() }).strict(),
  }),
  respond(async (req) => ({ substitution: await substitutions.respond(req.customer.id, req.params.substitutionId, req.body) })),
);

// ── Merchant ────────────────────────────────────────────────────────────────

merchantMessagingRouter.get(
  '/:storeId/conversations',
  ...ownStore({
    query: z
      .object({
        status: z.enum(['awaiting_store', 'awaiting_customer', 'resolved', 'escalated']).optional(),
        kind: z.enum(['question', 'special_request', 'order', 'support']).optional(),
      })
      .strict(),
  }),
  respond(async (req) => ({ conversations: await messaging.listStoreConversations(req.store, req.query) })),
);

merchantMessagingRouter.get(
  '/:storeId/conversations/:conversationId',
  ...ownStore({ params: storeIdParams({ conversationId: uuid('conversation') }) }),
  respond(async (req) => ({ conversation: await messaging.getStoreConversation(req.store, req.params.conversationId) })),
);

merchantMessagingRouter.post(
  '/:storeId/conversations/:conversationId/messages',
  ...ownStore({
    params: storeIdParams({ conversationId: uuid('conversation') }),
    body: z.object({ body, resolve: z.boolean().optional() }).strict(),
    write: true,
  }),
  respond(
    async (req) => ({
      conversation: await messaging.merchantReply(req.store, req.merchant, req.params.conversationId, req.body.body, { resolve: req.body.resolve }),
    }),
    { created: true },
  ),
);

merchantMessagingRouter.post(
  '/:storeId/orders/:orderId/substitutions',
  ...ownStore({
    params: storeIdParams({ orderId: uuid('order') }),
    body: z
      .object({
        orderItemId: uuid('order item'),
        variantId: uuid('variant'),
        quantity: z.number().int().min(1).max(999).optional(),
        note: z.string().trim().min(1).max(300).optional(),
      })
      .strict(),
    write: true,
  }),
  respond(async (req) => ({ substitution: await substitutions.propose(req.store, req.params.orderId, req.body) }), { created: true }),
);

merchantMessagingRouter.post(
  '/:storeId/substitutions/:substitutionId/withdraw',
  ...ownStore({ params: storeIdParams({ substitutionId: uuid('substitution') }), body: emptyBody }),
  respond(async (req) => ({ substitution: await substitutions.withdraw(req.store, req.params.substitutionId) })),
);

merchantMessagingRouter.get(
  '/:storeId/announcements',
  ...ownStore(),
  respond(async (req) => ({ announcements: await announcements.listAnnouncements(req.store), audience: await announcements.audienceSize(req.store) })),
);

merchantMessagingRouter.post(
  '/:storeId/announcements',
  ...ownStore({
    body: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().max(500).optional() }).strict(),
    write: true,
  }),
  respond(async (req) => ({ announcement: await announcements.announce(req.store, req.merchant, req.body) }), { created: true }),
);

// ── Platform support ────────────────────────────────────────────────────────

adminSupportRouter.get('/', requireAuth, ...requirePermission('handleSupport'), respond(async () => ({ conversations: await messaging.listEscalated() })));

adminSupportRouter.get(
  '/:conversationId',
  requireAuth,
  validate({ params: conversationParams }),
  ...requirePermission('handleSupport'),
  respond(async (req) => ({ conversation: await messaging.getEscalated(req.params.conversationId) })),
);

adminSupportRouter.post(
  '/:conversationId/messages',
  writeLimiter,
  requireAuth,
  validate({ params: conversationParams }),
  ...requirePermission('handleSupport'),
  validate({ body: z.object({ body, resolve: z.boolean().optional() }).strict() }),
  respond(async (req) => ({ conversation: await messaging.adminReply(req.admin, req.params.conversationId, req.body.body, { resolve: req.body.resolve }) }), {
    created: true,
  }),
);
