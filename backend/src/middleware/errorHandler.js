import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

/** Any route that did not match falls through to here. */
export function notFoundHandler(req, res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Cannot ${req.method} ${req.originalUrl}`));
}

/**
 * The single place errors become responses.
 * Operational errors are reported as-is; anything else becomes a generic 500
 * so internal details never reach the client.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
export function errorHandler(err, req, res, next) {
  const isOperational = err instanceof AppError;

  const statusCode = isOperational ? err.statusCode : 500;
  const code = isOperational ? err.code : 'INTERNAL_ERROR';
  const message = isOperational ? err.message : 'Something went wrong on our end.';

  if (statusCode >= 500) {
    logger.error('unhandled error', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      code,
      errorMessage: err.message,
      stack: err.stack,
    });
  }

  const body = {
    success: false,
    error: { code, message },
    requestId: req.id,
  };

  if (isOperational && err.details) body.error.details = err.details;
  // Stack traces are a development aid only.
  if (!isOperational && !env.isProduction && !env.isTest) body.error.stack = err.stack;

  res.status(statusCode).json(body);
}
