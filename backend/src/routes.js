import { Router } from 'express';
import { healthRouter } from './modules/health/health.routes.js';

/**
 * All v1 routes are mounted here. Each module owns its own router;
 * this file is the only place that knows the full URL map.
 */
export const apiRouter = Router();

apiRouter.use(healthRouter);

// Mounted as phases land:
// apiRouter.use('/auth', authRouter);          Phase 2
// apiRouter.use('/me', profileRouter);         Phase 2
// apiRouter.use('/stores', storeRouter);       Phase 3
// apiRouter.use('/cart', cartRouter);          Phase 5
// apiRouter.use('/addresses', addressRouter);  Phase 6
// apiRouter.use('/orders', orderRouter);       Phase 7
