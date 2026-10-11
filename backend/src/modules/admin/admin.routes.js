import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { authLimiter, writeLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireAdmin, loadAdmin } from '../../middleware/requireAdmin.js';
import { respond, respondPage, pageQuery, uuid } from '../../lib/merchantRoute.js';
import { forbidden } from '../../lib/errors.js';
import { loginSchema } from '../auth/auth.schemas.js';
import { signInWithPassword, endSession, toSession } from '../auth/auth.service.js';
import * as verification from '../verification/verification.service.js';
import { adminSupportRouter } from '../messaging/messaging.routes.js';

/**
 * /admin — the platform's own reviewers, for store verification (roadmap §4
 * P1). Every route but sign-in needs a platform_admins row.
 */
export const adminRouter = Router();

const toAdmin = (row) => ({ id: row.id, email: row.email, fullName: row.full_name ?? null });

adminRouter.post(
  '/auth/login',
  authLimiter,
  validate({ body: loginSchema }),
  respond(async (req) => {
    const data = await signInWithPassword(req.body);
    const admin = await loadAdmin(data.user.id);
    if (!admin) {
      await endSession(data.session.access_token);
      throw forbidden('This account cannot review stores.');
    }
    return { admin: toAdmin(admin), session: toSession(data.session), roles: ['admin'] };
  }),
);

adminRouter.get('/me', requireAuth, requireAdmin, respond(async (req) => ({ admin: toAdmin(req.admin) })));

const statuses = z
  .string()
  .trim()
  .transform((value) => value.split(',').map((part) => part.trim()).filter(Boolean))
  .pipe(z.array(z.enum(['not_submitted', 'pending', 'verified', 'rejected'])).min(1));

const storeParams = z.object({ storeId: uuid('store') }).strict();

adminRouter.get(
  '/verifications',
  requireAuth,
  requireAdmin,
  validate({ query: pageQuery({ status: statuses.optional() }, { maxLimit: 50 }) }),
  respondPage(async (req) => {
    const { stores, total } = await verification.listForReview(req.query);
    return { data: { stores }, total };
  }),
);

adminRouter.get(
  '/verifications/:storeId',
  requireAuth,
  validate({ params: storeParams }),
  requireAdmin,
  respond(async (req) => verification.reviewView(req.params.storeId)),
);

adminRouter.get(
  '/verifications/:storeId/documents/:documentId/url',
  requireAuth,
  validate({ params: z.object({ storeId: uuid('store'), documentId: uuid('document') }).strict() }),
  requireAdmin,
  respond(async (req) => verification.documentUrl(req.params.storeId, req.params.documentId)),
);

adminRouter.post(
  '/verifications/:storeId/approve',
  writeLimiter,
  requireAuth,
  validate({ params: storeParams }),
  requireAdmin,
  validate({ body: z.object({ note: z.string().trim().min(1).max(500).optional() }).strict() }),
  respond(async (req) => verification.decide(req.params.storeId, req.admin, { decision: 'approve', note: req.body.note ?? null })),
);

adminRouter.post(
  '/verifications/:storeId/reject',
  writeLimiter,
  requireAuth,
  validate({ params: storeParams }),
  requireAdmin,
  validate({
    body: z
      .object({
        reason: z.string().trim().min(3, 'Tell the merchant what to fix (3 characters or more).').max(500),
        note: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
  }),
  respond(async (req) =>
    verification.decide(req.params.storeId, req.admin, { decision: 'reject', reason: req.body.reason, note: req.body.note ?? null }),
  ),
);

// Escalated customer support (roadmap §5 P5).
adminRouter.use('/support', adminSupportRouter);
