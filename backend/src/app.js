import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';

import { env } from './config/env.js';
import { apiRouter } from './routes.js';
import { requestContext, requestLogger } from './middleware/requestContext.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { forbidden } from './lib/errors.js';

export const API_PREFIX = '/api/v1';

export function createApp() {
  const app = express();

  // Behind a proxy (Render/Railway/nginx) so rate limiting sees the real client IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin, curl and server-to-server requests send no Origin header.
        if (!origin) return callback(null, true);
        if (env.corsOrigins.includes(origin)) return callback(null, true);
        return callback(forbidden(`Origin ${origin} is not allowed.`));
      },
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(compression());

  // Payload cap — a shopping cart never needs more than this.
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  app.use(requestContext);
  app.use(requestLogger);

  app.use(API_PREFIX, globalLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
