import { Router } from 'express';
import { z } from 'zod';
import { ownStore, storeIdParams, uuid, respond, pageQuery } from '../../lib/merchantRoute.js';
import { badRequest } from '../../lib/errors.js';
import * as khata from './merchantKhata.service.js';

/** /merchant/stores/:storeId/khata — MERCHANT_API.md, Khata. */
export const merchantKhataRouter = Router();

const accountParams = storeIdParams({ accountId: uuid('khata account') });
const paise = (max = 10_000_000) => z.number().int().positive().max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

const openSchema = z
  .object({
    customerId: uuid('customer').optional(),
    email: z.string().trim().email().max(254).optional(),
    phone: z.string().trim().regex(/^\+?[0-9]{7,15}$/, 'Enter a valid phone number.').optional(),
    creditLimitPaise: z.number().int().nonnegative().max(100_000_000).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((v) => [v.customerId, v.email, v.phone].filter(Boolean).length === 1, {
    message: 'Identify the customer by exactly one of customerId, email or phone.',
    path: ['customerId'],
  });

const updateSchema = z
  .object({
    creditLimitPaise: z.number().int().nonnegative().max(100_000_000).nullable().optional(),
    isActive: z.boolean().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    remindersEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field.' });

const entrySchema = z
  .object({
    kind: z.enum(['charge', 'payment', 'adjustment']),
    amountPaise: paise(),
    description: z.string().trim().min(1).max(300).optional(),
    dueDate: isoDate.optional(),
    paymentMethod: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'other']).optional(),
    direction: z.enum(['debit', 'credit']).optional(),
    orderId: uuid('order').optional(),
  })
  .strict()
  .refine((v) => v.kind !== 'adjustment' || (v.direction && v.description), {
    message: 'An adjustment needs a direction and a reason.',
    path: ['direction'],
  })
  .refine((v) => v.kind === 'charge' || v.dueDate === undefined, {
    message: 'Only a charge has a due date.',
    path: ['dueDate'],
  })
  .refine((v) => v.kind === 'payment' || v.paymentMethod === undefined, {
    message: 'Only a payment has a payment method.',
    path: ['paymentMethod'],
  });

const listQuery = z
  .object({
    search: z.string().trim().min(1).max(100).optional(),
    status: z.enum(['all', 'outstanding', 'overdue']).default('all'),
  })
  .strict();

const statementQuery = pageQuery(
  {
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  },
  { maxLimit: 100 },
);

const idempotencyKeyOf = (req) => {
  const key = req.get('idempotency-key')?.trim() || null;
  if (key && key.length > 200) throw badRequest('The Idempotency-Key header is too long.');
  return key;
};

merchantKhataRouter.put(
  '/:storeId/khata-settings',
  ...ownStore({
    body: z
      .object({ khataEnabled: z.boolean().optional(), khataDueDays: z.number().int().min(0).max(365).optional() })
      .strict(),
  }),
  respond(async (req) => ({ settings: await khata.updateSettings(req.store, req.body) })),
);

merchantKhataRouter.get(
  '/:storeId/khata',
  ...ownStore({ query: listQuery }),
  respond(async (req) => khata.listAccounts(req.store, req.query)),
);

merchantKhataRouter.post(
  '/:storeId/khata',
  ...ownStore({ body: openSchema, write: true }),
  respond(async (req) => khata.openAccount(req.store, req.merchant, req.body), { created: true }),
);

merchantKhataRouter.get(
  '/:storeId/khata/:accountId',
  ...ownStore({ params: accountParams, query: pageQuery({}, { maxLimit: 100 }) }),
  respond(async (req) => khata.getAccount(req.store, req.params.accountId, req.query)),
);

merchantKhataRouter.patch(
  '/:storeId/khata/:accountId',
  ...ownStore({ params: accountParams, body: updateSchema }),
  respond(async (req) => khata.updateAccount(req.store, req.params.accountId, req.body)),
);

merchantKhataRouter.post(
  '/:storeId/khata/:accountId/entries',
  ...ownStore({ params: accountParams, body: entrySchema, write: true }),
  respond(
    async (req) =>
      khata.addEntry(req.store, req.merchant, req.params.accountId, req.body, { idempotencyKey: idempotencyKeyOf(req) }),
    { created: true },
  ),
);

merchantKhataRouter.post(
  '/:storeId/khata/:accountId/entries/:transactionId/reverse',
  ...ownStore({
    params: storeIdParams({ accountId: uuid('khata account'), transactionId: uuid('khata entry') }),
    body: z.object({ reason: z.string().trim().min(3, 'Say why (3 characters or more).').max(300) }).strict(),
    write: true,
  }),
  respond(
    async (req) => khata.reverseEntry(req.store, req.merchant, req.params.accountId, req.params.transactionId, req.body),
    { created: true },
  ),
);

merchantKhataRouter.post(
  '/:storeId/khata/:accountId/reminders',
  ...ownStore({
    params: accountParams,
    body: z.object({ note: z.string().trim().min(1).max(300).optional() }).strict(),
    write: true,
  }),
  respond(async (req) => khata.sendReminder(req.store, req.merchant, req.params.accountId, req.body), { created: true }),
);

merchantKhataRouter.get(
  '/:storeId/khata/:accountId/statement',
  ...ownStore({ params: accountParams, query: statementQuery }),
  respond(async (req) => khata.statement(req.store, req.params.accountId, req.query)),
);
