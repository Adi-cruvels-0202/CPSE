import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { authLimiter, writeLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireAdmin, requirePermission, loadAdmin, permissionsFor, ADMIN_ROLES } from '../../middleware/requireAdmin.js';
import { respond, respondPage, pageQuery, uuid } from '../../lib/merchantRoute.js';
import { forbidden } from '../../lib/errors.js';
import { loginSchema } from '../auth/auth.schemas.js';
import { signInWithPassword, endSession, toSession } from '../auth/auth.service.js';
import * as verification from '../verification/verification.service.js';
import { adminSupportRouter } from '../messaging/messaging.routes.js';
import * as portal from './adminPortal.service.js';

/**
 * /admin — the platform admin portal: store verification (roadmap §4 P1),
 * escalated support (§5 P5), and since migration 0045 every store, every
 * account, the admins and their action log. Every route but sign-in needs a
 * platform_admins row, and each needs its role to allow it
 * (middleware/requireAdmin.js has the table).
 */
export const adminRouter = Router();

const toAdmin = (row) => ({ id: row.id, email: row.email, fullName: row.full_name ?? null, role: row.role, permissions: permissionsFor(row.role) });

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
  ...requirePermission('reviewStores'),
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
  ...requirePermission('reviewStores'),
  respond(async (req) => verification.reviewView(req.params.storeId)),
);

adminRouter.get(
  '/verifications/:storeId/documents/:documentId/url',
  requireAuth,
  validate({ params: z.object({ storeId: uuid('store'), documentId: uuid('document') }).strict() }),
  ...requirePermission('reviewStores'),
  respond(async (req) => verification.documentUrl(req.params.storeId, req.params.documentId)),
);

adminRouter.post(
  '/verifications/:storeId/approve',
  writeLimiter,
  requireAuth,
  validate({ params: storeParams }),
  ...requirePermission('reviewStores'),
  validate({ body: z.object({ note: z.string().trim().min(1).max(500).optional() }).strict() }),
  respond(async (req) => verification.decide(req.params.storeId, req.admin, { decision: 'approve', note: req.body.note ?? null })),
);

adminRouter.post(
  '/verifications/:storeId/reject',
  writeLimiter,
  requireAuth,
  validate({ params: storeParams }),
  ...requirePermission('reviewStores'),
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

// ── Portal (migration 0045) ─────────────────────────────────────────────────

const reason = (what) => z.string().trim().min(3, `Say why ${what} (3 characters or more).`).max(500);
const search = z.string().trim().min(1).max(100).optional();
const accountParams = z.object({ accountId: uuid('account') }).strict();
const adminParams = z.object({ adminId: uuid('admin') }).strict();
const role = z.enum(ADMIN_ROLES);

adminRouter.get(
  '/overview',
  requireAuth,
  ...requirePermission('viewOverview'),
  respond(async (req) => ({ overview: await portal.overview(req.admin) })),
);

adminRouter.get(
  '/stores',
  requireAuth,
  ...requirePermission('viewStores'),
  validate({
    query: pageQuery({
      search,
      verification: z.enum(['not_submitted', 'pending', 'verified', 'rejected']).optional(),
      published: z.enum(['yes', 'no']).optional(),
    }, { maxLimit: 50 }),
  }),
  respondPage(async (req) => {
    const { stores, total } = await portal.listStores(req.query);
    return { data: { stores }, total };
  }),
);

adminRouter.get(
  '/stores/:storeId',
  requireAuth,
  validate({ params: storeParams }),
  ...requirePermission('viewStores'),
  respond(async (req) => portal.storeDetail(req.params.storeId)),
);

adminRouter.post(
  '/stores/:storeId/unpublish',
  writeLimiter,
  requireAuth,
  validate({ params: storeParams }),
  ...requirePermission('moderateStores'),
  validate({ body: z.object({ reason: reason('the store is taken off') }).strict() }),
  respond(async (req) => portal.unpublishStore(req.admin, req.params.storeId, req.body)),
);

adminRouter.get(
  '/accounts',
  requireAuth,
  ...requirePermission('viewAccounts'),
  validate({
    query: pageQuery({
      search,
      kind: z.enum(['all', 'customer', 'merchant']).default('all'),
      status: z.enum(['all', 'active', 'suspended']).default('all'),
    }, { maxLimit: 50 }),
  }),
  respondPage(async (req) => {
    const { accounts, total } = await portal.listAccounts(req.query);
    return { data: { accounts }, total };
  }),
);

adminRouter.get(
  '/accounts/:accountId',
  requireAuth,
  validate({ params: accountParams }),
  ...requirePermission('viewAccounts'),
  respond(async (req) => portal.accountDetail(req.params.accountId)),
);

adminRouter.post(
  '/accounts/:accountId/suspend',
  writeLimiter,
  requireAuth,
  validate({ params: accountParams }),
  ...requirePermission('suspendAccounts'),
  validate({ body: z.object({ reason: reason('the account is suspended') }).strict() }),
  respond(async (req) => portal.suspendAccount(req.admin, req.params.accountId, req.body)),
);

adminRouter.post(
  '/accounts/:accountId/reinstate',
  writeLimiter,
  requireAuth,
  validate({ params: accountParams }),
  ...requirePermission('suspendAccounts'),
  validate({ body: z.object({ reason: reason('the account is reinstated') }).strict() }),
  respond(async (req) => portal.reinstateAccount(req.admin, req.params.accountId, req.body)),
);

adminRouter.get(
  '/admins',
  requireAuth,
  ...requirePermission('manageAdmins'),
  respond(async () => portal.listAdmins()),
);

adminRouter.post(
  '/admins',
  writeLimiter,
  requireAuth,
  ...requirePermission('manageAdmins'),
  validate({ body: z.object({ email: z.string().trim().email('Enter a valid email.').max(254), role }).strict() }),
  respond(async (req) => ({ admin: await portal.addAdmin(req.admin, req.body) }), { created: true }),
);

adminRouter.patch(
  '/admins/:adminId',
  writeLimiter,
  requireAuth,
  validate({ params: adminParams }),
  ...requirePermission('manageAdmins'),
  validate({ body: z.object({ role }).strict() }),
  respond(async (req) => ({ admin: await portal.changeAdminRole(req.admin, req.params.adminId, req.body) })),
);

adminRouter.post(
  '/admins/:adminId/remove',
  writeLimiter,
  requireAuth,
  validate({ params: adminParams }),
  ...requirePermission('manageAdmins'),
  validate({ body: z.object({ reason: reason('the admin is removed') }).strict() }),
  respond(async (req) => portal.removeAdmin(req.admin, req.params.adminId, req.body)),
);

adminRouter.get(
  '/log',
  requireAuth,
  ...requirePermission('viewLog'),
  validate({
    query: pageQuery({
      targetType: z.enum(['store', 'account', 'admin']).optional(),
      action: z.string().trim().min(1).max(40).optional(),
    }, { maxLimit: 100 }),
  }),
  respondPage(async (req) => {
    const { actions, total } = await portal.listActions(req.query);
    return { data: { actions }, total };
  }),
);
