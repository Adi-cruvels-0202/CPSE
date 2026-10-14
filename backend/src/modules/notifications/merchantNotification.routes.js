import { Router } from 'express';
import { z } from 'zod';
import { ownStore, storeIdParams, uuid, respond, respondPage, pageQuery } from '../../lib/merchantRoute.js';
import { emptyBody } from '../../lib/schemas.js';
import * as inbox from './merchantNotification.service.js';

/** /merchant/stores/:storeId/notifications — the store's inbox (migration 0036). */
export const merchantNotificationRouter = Router();

const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

merchantNotificationRouter.get(
  '/:storeId/notifications',
  ...ownStore({ query: pageQuery({ unreadOnly: booleanQuery.optional() }, { maxLimit: 50 }) }),
  respondPage(async (req) => {
    const { notifications, total, unreadCount } = await inbox.listForStore(req.store, req.query);
    return { data: { notifications, unreadCount }, total };
  }),
);

merchantNotificationRouter.post(
  '/:storeId/notifications/read-all',
  ...ownStore({ body: emptyBody }),
  respond(async (req) => inbox.markAllRead(req.store)),
);

merchantNotificationRouter.post(
  '/:storeId/notifications/:notificationId/read',
  ...ownStore({ params: storeIdParams({ notificationId: uuid('notification') }), body: emptyBody }),
  respond(async (req) => ({ notification: await inbox.markRead(req.store, req.params.notificationId) })),
);
