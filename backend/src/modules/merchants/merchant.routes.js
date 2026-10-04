import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authLimiter, writeLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireMerchant } from '../../middleware/requireMerchant.js';
import { merchantStoreRouter } from '../merchantStores/merchantStore.routes.js';
import { catalogueRouter } from '../merchantCatalogue/catalogue.routes.js';
import { inventoryRouter } from '../merchantInventory/inventory.routes.js';
import { merchantOrderRouter } from '../merchantOrders/merchantOrder.routes.js';
import { saleRouter } from '../merchantSales/sale.routes.js';
import { dashboardRouter } from '../merchantDashboard/dashboard.routes.js';
import * as controller from './merchant.controller.js';
import { loginSchema } from '../auth/auth.schemas.js';
import { registerMerchantSchema, updateMerchantSchema } from './merchant.schemas.js';

/**
 * Everything under /merchant (MERGE_MAPPING D-11). Refresh, logout and
 * password reset are the shared /auth endpoints; sign-in is not, because a
 * shop account and a customer account are separate logins (D-2, revised).
 *
 * Guard order on every route:
 *
 *   requireAuth (401) → path params (422) → requireMerchant (403)
 *     → requireStoreOwner (404, store-scoped routes) → body (422)
 *
 * A malformed id is a 422 for everyone, never a 403 that hides the mistake;
 * the role is checked before the body, so a non-merchant learns nothing about
 * what a merchant request should look like. tests/routeAudit.test.js holds
 * every /merchant route to the 401 and 403 halves of this.
 */
export const merchantRouter = Router();

merchantRouter.post(
  '/auth/register',
  authLimiter,
  validate({ body: registerMerchantSchema }),
  controller.register,
);

// The shop app's own sign-in: it refuses a customer account, as /auth/login
// refuses a shop account (D-2, revised). Refresh, logout and password reset
// stay the shared /auth endpoints.
merchantRouter.post('/auth/login', authLimiter, validate({ body: loginSchema }), controller.login);

merchantRouter.get('/me', requireAuth, requireMerchant, controller.getMe);
merchantRouter.patch(
  '/me',
  requireAuth,
  requireMerchant,
  validate({ body: updateMerchantSchema }),
  controller.updateMe,
);

// Store-scoped routes: /merchant/stores and /merchant/stores/:storeId/…
merchantRouter.use('/stores', merchantStoreRouter);
merchantRouter.use('/stores', catalogueRouter);
merchantRouter.use('/stores', inventoryRouter);
merchantRouter.use('/stores', merchantOrderRouter);
merchantRouter.use('/stores', saleRouter);
merchantRouter.use('/stores', dashboardRouter);
