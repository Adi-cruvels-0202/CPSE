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

/**
 * Checklist 10.7. Writes that cost real work — placing an order, initiating a
 * payment — get their own tighter bucket. A customer places a handful of orders
 * an hour at the very most; a script placing hundreds is not a customer.
 */
export const writeLimiter = build({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.WRITE_RATE_LIMIT_MAX,
  name: 'order',
});

/**
 * The gateway is not a browser and must not be rationed like one: a 429 makes a
 * real provider retry the same event for hours. Its requests are authenticated
 * by an HMAC over the body (D33), so the signature is the real gate here and
 * this limit exists only to bound an unsigned flood.
 */
export const webhookLimiter = build({
  windowMs: 60_000,
  max: env.WEBHOOK_RATE_LIMIT_MAX,
  name: 'webhook',
});
