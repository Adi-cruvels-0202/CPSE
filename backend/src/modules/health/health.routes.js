import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendSuccess } from '../../lib/response.js';
import { env } from '../../config/env.js';

export const healthRouter = Router();

/** Liveness probe. Intentionally does not touch the database. */
healthRouter.get(
  '/health',
  asyncHandler(async (req, res) => {
    sendSuccess(res, {
      status: 'ok',
      service: 'cpse-backend',
      environment: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  }),
);
