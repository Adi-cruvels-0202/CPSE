import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { tooManyRequests } from '../lib/errors.js';

function build({ windowMs, max, name }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Disabled in tests so the suite never trips a limiter.
    skip: () => env.isTest,
    handler: (req, res, next) =>
      next(tooManyRequests(`Too many ${name} requests. Please try again later.`)),
  });
}

/** Applied to the whole API. */
export const globalLimiter = build({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  name: 'API',
});

/** Tighter limit for credential endpoints — login, register, password reset. */
export const authLimiter = build({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  name: 'authentication',
});
