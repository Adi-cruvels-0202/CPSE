import { Router } from 'express';
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { profileRouter } from './modules/profile/profile.routes.js';

/**
 * All v1 routes are mounted here. Each module owns its own router;
 * this file is the only place that knows the full URL map.
 */
export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/me', profileRouter);

// Mounted as phases land:
// apiRouter.use('/stores', storeRouter);       Phase 3
// apiRouter.use('/cart', cartRouter);          Phase 5
// apiRouter.use('/addresses', addressRouter);  Phase 6
// apiRouter.use('/orders', orderRouter);       Phase 7
