import { Router } from 'express';
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { profileRouter } from './modules/profile/profile.routes.js';
import { storeRouter } from './modules/stores/store.routes.js';
import { cartRouter } from './modules/cart/cart.routes.js';
import { addressRouter } from './modules/addresses/address.routes.js';
import { checkoutRouter } from './modules/checkout/checkout.routes.js';
import { orderRouter } from './modules/orders/order.routes.js';
import { paymentRouter } from './modules/payments/payment.routes.js';
import { savedStoreRouter } from './modules/savedStores/savedStore.routes.js';
import { notificationRouter } from './modules/notifications/notification.routes.js';
import { khataRouter } from './modules/khata/khata.routes.js';
import { merchantRouter } from './modules/merchants/merchant.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { meRouter, customerStoreRouter, publicOfferRouter, storeOffersHandler } from './modules/engagement/engagement.routes.js';
import { conversationRouter, substitutionRouter } from './modules/messaging/messaging.routes.js';
import { customerIntelligenceRouter, meIntelligenceRouter } from './modules/intelligence/intelligence.routes.js';

/**
 * All v1 routes are mounted here. Each module owns its own router;
 * this file is the only place that knows the full URL map.
 */
export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use('/auth', authRouter);
// Engagement (/me/preferences, /me/lists, …) before the profile router, whose
// requireCustomer would otherwise run twice for these paths.
apiRouter.use('/me', meRouter);
apiRouter.use('/me', meIntelligenceRouter);
apiRouter.use('/me', profileRouter);
apiRouter.use('/stores', customerStoreRouter);
apiRouter.get('/stores/:slug/offers', ...storeOffersHandler);
apiRouter.use('/stores', customerIntelligenceRouter);
apiRouter.use('/stores', storeRouter);
apiRouter.use('/offers', publicOfferRouter);
apiRouter.use('/conversations', conversationRouter);
apiRouter.use('/substitutions', substitutionRouter);
apiRouter.use('/cart', cartRouter);
apiRouter.use('/addresses', addressRouter);
apiRouter.use('/checkout', checkoutRouter);
apiRouter.use('/orders', orderRouter);
apiRouter.use('/payments', paymentRouter);
apiRouter.use('/saved-stores', savedStoreRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/khata', khataRouter);
// The shopkeeper side (MERGE_MAPPING D-11): role-gated, and store-scoped below
// /merchant/stores/:storeId.
apiRouter.use('/merchant', merchantRouter);
// Platform reviewers (store verification). Separate from both apps' roles.
apiRouter.use('/admin', adminRouter);
