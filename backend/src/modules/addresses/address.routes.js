import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import * as controller from './address.controller.js';
import { addressParams, createAddressSchema, updateAddressSchema } from './address.schemas.js';
import { emptyBody } from '../../lib/schemas.js';

/** Checklist 6.6: authenticated throughout — an address always has an owner. */
export const addressRouter = Router();

addressRouter.use(requireAuth);

addressRouter.get('/', controller.listAddresses);
addressRouter.post('/', validate({ body: createAddressSchema }), controller.createAddress);

addressRouter.get('/:id', validate({ params: addressParams }), controller.getAddress);
addressRouter.patch(
  '/:id',
  validate({ params: addressParams, body: updateAddressSchema }),
  controller.updateAddress,
);
addressRouter.delete('/:id', validate({ params: addressParams }), controller.deleteAddress);
addressRouter.post(
  '/:id/default',
  validate({ params: addressParams, body: emptyBody }),
  controller.setDefaultAddress,
);
