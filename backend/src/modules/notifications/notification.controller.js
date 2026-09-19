import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../../lib/response.js';
import * as notificationService from './notification.service.js';

/** Checklist 9.4 */
export const listNotifications = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const { notifications, total, unreadCount } = await notificationService.listNotifications(
    req.customer.id,
    req.query,
  );

  sendSuccess(res, { notifications, unreadCount }, { meta: paginationMeta({ page, limit, total }) });
});

/** The badge on its own, for a client that only needs the number. */
export const getUnreadCount = asyncHandler(async (req, res) => {
  sendSuccess(res, { unreadCount: await notificationService.unreadCount(req.customer.id) });
});

/** Checklist 9.5 */
export const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markRead(req.customer.id, req.params.id);
  sendSuccess(res, { notification });
});

/** Checklist 9.5 */
export const markAllRead = asyncHandler(async (req, res) => {
  sendSuccess(res, await notificationService.markAllRead(req.customer.id));
});
