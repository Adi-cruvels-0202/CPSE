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

/**
 * All v1 routes are mounted here. Each module owns its own router;
 * this file is the only place that knows the full URL map.
 */
export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/me', profileRouter);
apiRouter.use('/stores', storeRouter);
apiRouter.use('/cart', cartRouter);
apiRouter.use('/addresses', addressRouter);
apiRouter.use('/checkout', checkoutRouter);
apiRouter.use('/orders', orderRouter);
apiRouter.use('/payments', paymentRouter);
