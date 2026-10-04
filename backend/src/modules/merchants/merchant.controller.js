import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, sendCreated } from '../../lib/response.js';
import * as merchantService from './merchant.service.js';

export const register = asyncHandler(async (req, res) => {
  sendCreated(res, await merchantService.registerMerchant(req.body));
});

export const login = asyncHandler(async (req, res) => {
  sendSuccess(res, await merchantService.loginMerchant(req.body));
});

export const getMe = asyncHandler(async (req, res) => {
  sendSuccess(res, await merchantService.getMerchantHome(req.merchant));
});

export const updateMe = asyncHandler(async (req, res) => {
  sendSuccess(res, { merchant: await merchantService.updateMerchant(req.merchant.id, req.body) });
});
