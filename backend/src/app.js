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

/**
 * CORS is decided per request rather than from a static allowlist, because the
 * app is now served from this very server. A `<script type="module">` is always
 * fetched in CORS mode, and a same-origin POST sends an Origin header too — so
 * a plain allowlist would 403 the app's own scripts and its own API calls. The
 * allowlist is still what governs *other* origins.
 */
function corsOptionsFor(req, callback) {
  const requestOrigin = req.headers.origin;
  // Behind a proxy `req.protocol` follows X-Forwarded-Proto, so this is the
  // origin the browser actually typed, not the one the socket terminated on.
  const ownOrigin = `${req.protocol}://${req.get('host')}`;

  const allowed =
    // curl and server-to-server requests send no Origin header at all.
    !requestOrigin || requestOrigin === ownOrigin || env.corsOrigins.includes(requestOrigin);

  if (!allowed) return callback(forbidden(`Origin ${requestOrigin} is not allowed.`));

  return callback(null, {
    origin: true,
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });
}

export function createApp() {
  const app = express();

  // Behind a proxy (Render/Railway/nginx) so rate limiting sees the real client IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Now that the app is served from here, helmet's CSP applies to it too.
  // In production the built app needs one relaxation: product images are
  // remote URLs, and the default `img-src 'self' data:` would blank them.
  // In development Vite injects an inline React-refresh preamble and opens an
  // HMR socket, neither of which any reasonable policy allows — so the policy
  // stands down entirely there.
  app.use(
    helmet({
      contentSecurityPolicy: env.isProduction
        ? {
            useDefaults: true,
            directives: { 'img-src': ["'self'", 'data:', 'https:'] },
          }
        : false,
    }),
  );
  app.use(cors(corsOptionsFor));
  app.use(compression());

  // The frontend is served from this same process and port (see lib/frontendHost.js).
  // The router is reserved here so it sits ahead of the body parsers and the
  // request logger — an app-shell or asset request should not be parsed as JSON
  // or logged as an API call. It stays empty until server.js fills it, and in
  // tests it is never filled at all, so API requests fall straight through.
  const frontendRouter = express.Router();
  app.locals.frontendRouter = frontendRouter;
  app.use(frontendRouter);

  // Payload cap — a shopping cart never needs more than this (checklist 10.7),
  // and it is configurable so a deployment can tighten it further. The raw body
  // is kept because a payment webhook's signature is over the exact bytes the
  // gateway sent; re-serialising the parsed JSON would change them.
  app.use(
    express.json({
      limit: env.JSON_BODY_LIMIT,
      verify: (req, res, buffer) => {
        req.rawBody = buffer.toString('utf8');
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: env.JSON_BODY_LIMIT }));

  app.use(requestContext);
  app.use(requestLogger);

  app.use(API_PREFIX, globalLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
