import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireCustomer } from '../../middleware/requireAuth.js';
import * as controller from './notification.controller.js';
import { notificationListQuery, notificationParams } from './notification.schemas.js';
import { emptyBody } from '../../lib/schemas.js';
import { respond } from '../../lib/merchantRoute.js';
import { deliveriesFor } from './notification.service.js';

/**
 * Checklist 9.4 – 9.5. Authenticated throughout: a notification always has an
 * owner, and there is no public view of one.
 *
 * There is no create endpoint. Notifications are emitted by the services that
 * change an order or a payment, so a client cannot manufacture one.
 */
export const notificationRouter = Router();

notificationRouter.use(requireCustomer);

notificationRouter.get('/', validate({ query: notificationListQuery }), controller.listNotifications);
notificationRouter.get('/unread-count', controller.getUnreadCount);

// Declared before /:id/read so "read-all" is never read as a notification id.
notificationRouter.post('/read-all', validate({ body: emptyBody }), controller.markAllRead);
notificationRouter.post(
  '/:id/read',
  validate({ params: notificationParams, body: emptyBody }),
  controller.markRead,
);

// Roadmap Phase C: how each channel of this notification was delivered.
notificationRouter.get(
  '/:id/deliveries',
  validate({ params: notificationParams }),
  respond(async (req) => ({ deliveries: await deliveriesFor(req.customer.id, req.params.id) })),
);
