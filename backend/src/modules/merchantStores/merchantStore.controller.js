import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../lib/response.js';
import * as storeService from './merchantStore.service.js';

/** requireStoreOwner has put the caller's own store on `req.store`. */

export const listStores = asyncHandler(async (req, res) => {
  sendSuccess(res, { stores: await storeService.listStores(req.merchant) });
});

export const createStore = asyncHandler(async (req, res) => {
  sendCreated(res, { store: await storeService.createStore(req.merchant, req.body) });
});

export const getStore = asyncHandler(async (req, res) => {
  sendSuccess(res, { store: await storeService.getStore(req.store) });
});

export const updateStore = asyncHandler(async (req, res) => {
  sendSuccess(res, { store: await storeService.updateStore(req.store, req.body) });
});

export const publishStore = asyncHandler(async (req, res) => {
  sendSuccess(res, { store: await storeService.publishStore(req.store) });
});

export const unpublishStore = asyncHandler(async (req, res) => {
  sendSuccess(res, { store: await storeService.unpublishStore(req.store) });
});

export const deleteStore = asyncHandler(async (req, res) => {
  await storeService.deleteStore(req.store, req.body);
  sendNoContent(res);
});

export const setHours = asyncHandler(async (req, res) => {
  sendSuccess(res, { store: await storeService.setHours(req.store, req.body) });
});

export const setDelivery = asyncHandler(async (req, res) => {
  sendSuccess(res, { store: await storeService.setDelivery(req.store, req.body) });
});

export const setPayments = asyncHandler(async (req, res) => {
  sendSuccess(res, { store: await storeService.setPayments(req.store, req.body) });
});

export const uploadLogo = asyncHandler(async (req, res) => {
  sendSuccess(res, { store: await storeService.setStorePhoto(req.store, 'logo', req.file) });
});

export const uploadCover = asyncHandler(async (req, res) => {
  sendSuccess(res, { store: await storeService.setStorePhoto(req.store, 'cover', req.file) });
});

export const listHolidays = asyncHandler(async (req, res) => {
  sendSuccess(res, { holidays: await storeService.listHolidays(req.store) });
});

export const addHoliday = asyncHandler(async (req, res) => {
  sendCreated(res, { holiday: await storeService.addHoliday(req.store, req.body) });
});

export const removeHoliday = asyncHandler(async (req, res) => {
  await storeService.removeHoliday(req.store, req.params.holidayId);
  sendNoContent(res);
});
