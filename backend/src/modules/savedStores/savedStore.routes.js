import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import * as controller from './savedStore.controller.js';
import { savedStoreListQuery } from './savedStore.schemas.js';

/**
 * Checklist 9.2 — `GET /api/v1/saved-stores`.
 *
 * Save and unsave live on the store router (`/stores/:storeId/save`), because
 * they act on a store; this router is only the list. Both are authenticated: a
 * favourite belongs to one customer.
 */
export const savedStoreRouter = Router();

savedStoreRouter.use(requireAuth);
savedStoreRouter.get('/', validate({ query: savedStoreListQuery }), controller.listSavedStores);
