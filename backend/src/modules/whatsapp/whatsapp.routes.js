import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess } from '../../lib/response.js';
import { forbidden } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { inboundMessages, verifySignature } from '../../lib/whatsapp.js';
import { validate } from '../../middleware/validate.js';
import { webhookLimiter, writeLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireMerchant } from '../../middleware/requireMerchant.js';
import * as service from './whatsapp.service.js';
import { handleInbound } from './whatsappBot.js';

/**
 * Two doors to the same feature:
 *
 *   /whatsapp/webhook          Meta → us. Public by design, but every POST
 *                              must carry Meta's signature over the exact body.
 *   /merchant/whatsapp         the shop owner's dashboard: link a number, see
 *                              the link, alerts on or off, unlink.
 */

// ── Meta webhook ────────────────────────────────────────────────────────────

export const whatsappWebhookRouter = Router();

/** Meta's one-time check when the webhook is registered: echo the challenge. */
whatsappWebhookRouter.get('/webhook', webhookLimiter, (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN && typeof challenge === 'string') {
    return res.status(200).type('text/plain').send(challenge);
  }
  throw forbidden('Webhook verification failed.');
});

whatsappWebhookRouter.post(
  '/webhook',
  webhookLimiter,
  asyncHandler(async (req, res) => {
    if (!verifySignature(req.rawBody, req.get('x-hub-signature-256'))) {
      throw forbidden('The webhook signature does not match.');
    }
    // Each message is handled on its own: one failing must not drop the rest,
    // and Meta must get its 200 or it retries the whole batch.
    for (const message of inboundMessages(req.body)) {
      try {
        await handleInbound(message);
      } catch (error) {
        logger.error('WhatsApp message could not be handled', { reason: error?.message ?? String(error) });
      }
    }
    return res.status(200).json({ success: true });
  }),
);

// ── Shop owner's dashboard ──────────────────────────────────────────────────

export const merchantWhatsappRouter = Router();
const owner = [requireAuth, requireMerchant];

merchantWhatsappRouter.get(
  '/',
  ...owner,
  asyncHandler(async (req, res) => sendSuccess(res, { whatsapp: await service.getStatus(req.merchant) })),
);

merchantWhatsappRouter.post(
  '/link',
  ...owner,
  writeLimiter,
  validate({ body: z.object({ phone: z.string().trim().min(8).max(24) }).strict() }),
  asyncHandler(async (req, res) => sendSuccess(res, { linking: await service.startLink(req.merchant, req.body) }, { status: 201 })),
);

merchantWhatsappRouter.patch(
  '/',
  ...owner,
  writeLimiter,
  validate({
    body: z
      .object({ notifyOrders: z.boolean().optional(), activeStoreId: z.string().uuid().optional() })
      .strict()
      .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one setting.' }),
  }),
  asyncHandler(async (req, res) => sendSuccess(res, { whatsapp: await service.updateSettings(req.merchant, req.body) })),
);

merchantWhatsappRouter.delete(
  '/link',
  ...owner,
  writeLimiter,
  asyncHandler(async (req, res) => {
    await service.unlink(req.merchant.id);
    sendSuccess(res, { whatsapp: await service.getStatus(req.merchant) });
  }),
);
