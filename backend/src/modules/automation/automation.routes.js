import { Router } from 'express';
import { z } from 'zod';
import { ownStore, storeIdParams, uuid, respond } from '../../lib/merchantRoute.js';
import { emptyBody } from '../../lib/schemas.js';
import * as automation from './automation.service.js';
import { storeAnalytics } from '../analytics/analytics.service.js';
import { createPurchase } from '../merchantPurchases/purchase.service.js';

/**
 * /merchant/stores/:storeId — analytics (roadmap §4 P4), low stock, purchase
 * suggestions and recurring tasks (Phase C). Mounted at /merchant/stores.
 */
export const automationRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

automationRouter.get(
  '/:storeId/analytics',
  ...ownStore({ query: z.object({ from: isoDate.optional(), to: isoDate.optional() }).strict() }),
  respond(async (req) => ({ analytics: await storeAnalytics(req.store, req.query) })),
);

automationRouter.get(
  '/:storeId/low-stock',
  ...ownStore(),
  respond(async (req) => ({
    items: (await automation.lowStockFor(req.store)).map(({ variant, product, available }) => ({
      productId: product.id,
      productName: product.name,
      variantId: variant.id,
      variantName: variant.name === 'Default' ? null : variant.name,
      sku: variant.sku ?? null,
      availableQuantity: available,
      lowStockThreshold: product.low_stock_threshold,
    })),
  })),
);

const suggestionQuery = z
  .object({
    coverDays: z.coerce.number().int().min(1).max(90).default(14),
    lookbackDays: z.coerce.number().int().min(7).max(180).default(30),
  })
  .strict();

automationRouter.get(
  '/:storeId/purchase-suggestions',
  ...ownStore({ query: suggestionQuery }),
  respond(async (req) => ({ suggestions: await automation.purchaseSuggestions(req.store, req.query) })),
);

/**
 * The merchant chooses lines (and may change quantities and costs); a DRAFT
 * purchase is created. Nothing reaches the shelf until they confirm it.
 */
automationRouter.post(
  '/:storeId/purchase-suggestions/draft',
  ...ownStore({
    write: true,
    body: z
      .object({
        supplierId: uuid('supplier').optional(),
        items: z
          .array(
            z
              .object({
                variantId: uuid('variant'),
                quantity: z.number().int().min(1).max(100_000),
                unitCostPaise: z.number().int().min(0).max(100_000_000),
              })
              .strict(),
          )
          .min(1, 'Choose at least one suggestion.')
          .max(200),
      })
      .strict(),
  }),
  respond(
    async (req) => ({
      purchase: await createPurchase(req.store, req.merchant, {
        supplierId: req.body.supplierId ?? null,
        notes: 'From purchase suggestions',
        items: req.body.items,
        confirm: false,
      }),
    }),
    { created: true },
  ),
);

const taskFields = {
  title: z.string().trim().min(1).max(120),
  taskType: z.enum(['reminder', 'low_stock_report', 'expiry_report', 'purchase_suggestions', 'khata_overdue_report']),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  timeOfDay: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use HH:MM (24-hour).').optional(),
};

const scheduleOk = (v) =>
  v.frequency === undefined ||
  v.frequency === 'daily' ||
  (v.frequency === 'weekly' && v.dayOfWeek !== undefined) ||
  (v.frequency === 'monthly' && v.dayOfMonth !== undefined);

automationRouter.get('/:storeId/tasks', ...ownStore(), respond(async (req) => ({ tasks: await automation.listTasks(req.store) })));

automationRouter.post(
  '/:storeId/tasks',
  ...ownStore({
    write: true,
    body: z.object(taskFields).strict().refine(scheduleOk, { message: 'A weekly task needs dayOfWeek; a monthly one, dayOfMonth.', path: ['frequency'] }),
  }),
  respond(async (req) => ({ task: await automation.createTask(req.store, req.merchant, req.body) }), { created: true }),
);

automationRouter.patch(
  '/:storeId/tasks/:taskId',
  ...ownStore({
    params: storeIdParams({ taskId: uuid('task') }),
    body: z
      .object({
        title: taskFields.title.optional(),
        frequency: taskFields.frequency.optional(),
        dayOfWeek: taskFields.dayOfWeek,
        dayOfMonth: taskFields.dayOfMonth,
        timeOfDay: taskFields.timeOfDay,
        isActive: z.boolean().optional(),
      })
      .strict()
      .refine(scheduleOk, { message: 'A weekly task needs dayOfWeek; a monthly one, dayOfMonth.', path: ['frequency'] }),
  }),
  respond(async (req) => ({ task: await automation.updateTask(req.store, req.params.taskId, req.body) })),
);

automationRouter.delete(
  '/:storeId/tasks/:taskId',
  ...ownStore({ params: storeIdParams({ taskId: uuid('task') }), body: emptyBody }),
  respond(async (req) => {
    await automation.deleteTask(req.store, req.params.taskId);
    return { deleted: true };
  }),
);

automationRouter.put(
  '/:storeId/khata-settings/auto-reminders',
  ...ownStore({ body: z.object({ enabled: z.boolean() }).strict() }),
  respond(async (req) => automation.setKhataAutoReminders(req.store, req.body.enabled)),
);
