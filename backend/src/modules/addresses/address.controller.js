import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../lib/response.js';
import * as addressService from './address.service.js';

/** Checklist 6.1 */
export const listAddresses = asyncHandler(async (req, res) => {
  sendSuccess(res, { addresses: await addressService.listAddresses(req.customer.id) });
});

/** Checklist 6.2 */
export const createAddress = asyncHandler(async (req, res) => {
  sendCreated(res, { address: await addressService.createAddress(req.customer.id, req.body) });
});

export const getAddress = asyncHandler(async (req, res) => {
  sendSuccess(res, { address: await addressService.getAddress(req.customer.id, req.params.id) });
});

/** Checklist 6.3 */
export const updateAddress = asyncHandler(async (req, res) => {
  const address = await addressService.updateAddress(req.customer.id, req.params.id, req.body);
  sendSuccess(res, { address });
});

/** Checklist 6.4 */
export const deleteAddress = asyncHandler(async (req, res) => {
  await addressService.deleteAddress(req.customer.id, req.params.id);
  sendNoContent(res);
});

/** Checklist 6.5 */
export const setDefaultAddress = asyncHandler(async (req, res) => {
  const address = await addressService.setDefaultAddress(req.customer.id, req.params.id);
  sendSuccess(res, { address });
});
