import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, sendCreated } from '../../lib/response.js';
import * as storeService from './merchantStore.service.js';

/** requireStoreOwner has put the caller's own store on `req.store`. */

export const listStores = asyncHandler(async (req, res) => {
  sendSuccess(res, { stores: await storeService.listStores(req.merchant) });
});

export const createStore = asyncHandler(async (req, res) => {
  sendCreated(res, { store: await storeService.createStore(req.merchant, req.body) });
});

export const getStore = asyncHandler(async (req, res) => {
  sendSuccess(res, { store: storeService.toMerchantStore(req.store) });
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

export const setHours = asyncHandler(async (req, res) => {
  sendSuccess(res, { store: await storeService.setHours(req.store, req.body) });
});

export const setDelivery = asyncHandler(async (req, res) => {
  sendSuccess(res, { store: await storeService.setDelivery(req.store, req.body) });
});

export const setPayments = asyncHandler(async (req, res) => {
  sendSuccess(res, { store: await storeService.setPayments(req.store, req.body) });
});
