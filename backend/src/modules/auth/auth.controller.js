import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../lib/response.js';
import * as authService from './auth.service.js';

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  sendCreated(res, result);
});

export const login = asyncHandler(async (req, res) => {
  sendSuccess(res, await authService.login(req.body));
});

export const refresh = asyncHandler(async (req, res) => {
  sendSuccess(res, await authService.refresh(req.body));
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.accessToken);
  sendNoContent(res);
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body);
  // Deliberately the same response whether or not the email is registered.
  sendSuccess(res, {
    message: 'If that email has an account, a reset link is on its way.',
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  sendSuccess(res, await authService.resetPassword(req.body));
});
