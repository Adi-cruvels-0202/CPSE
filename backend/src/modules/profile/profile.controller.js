import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess } from '../../lib/response.js';
import { toPublicCustomer } from '../auth/auth.service.js';
import * as profileService from './profile.service.js';

/** Checklist 2.8 — requireAuth has already loaded the row. */
export const getMe = asyncHandler(async (req, res) => {
  sendSuccess(res, { customer: toPublicCustomer(req.customer) });
});

/** Checklist 2.9 */
export const updateMe = asyncHandler(async (req, res) => {
  const customer = await profileService.updateProfile(req.customer.id, req.body);
  sendSuccess(res, { customer });
});
