import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, sendCreated } from '../../lib/response.js';
import * as merchantService from './merchant.service.js';

export const register = asyncHandler(async (req, res) => {
  sendCreated(res, await merchantService.registerMerchant(req.body));
});

/** 201 the first time, 200 for someone who is already a merchant. */
export const onboard = asyncHandler(async (req, res) => {
  const { merchant, created } = await merchantService.onboardMerchant(req.customer, req.body);
  if (created) sendCreated(res, { merchant });
  else sendSuccess(res, { merchant });
});

export const getMe = asyncHandler(async (req, res) => {
  sendSuccess(res, await merchantService.getMerchantHome(req.merchant));
});

export const updateMe = asyncHandler(async (req, res) => {
  sendSuccess(res, { merchant: await merchantService.updateMerchant(req.merchant.id, req.body) });
});
