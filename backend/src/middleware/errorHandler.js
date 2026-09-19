import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

/**
 * express.json() rejects a body before any handler sees it, and its errors are
 * not AppErrors — so without this they were reported as 500s, telling a client
 * that its own oversized or malformed request was our fault (checklist 10.5).
 */
function translateBodyParserError(err) {
  if (err instanceof AppError) return err;

  if (err?.type === 'entity.too.large') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.', {
      limit: err.limit ?? null,
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return new AppError(400, 'MALFORMED_JSON', 'The request body is not valid JSON.');
  }
  if (err?.type === 'charset.unsupported' || err?.type === 'encoding.unsupported') {
    return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'That content encoding is not supported.');
  }

  return err;
}

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
  // A body-parser rejection is translated first, so the rest of this function
  // only ever deals with an AppError or a genuine surprise.
  const error = translateBodyParserError(err);
  const isOperational = error instanceof AppError;

  const statusCode = isOperational ? error.statusCode : 500;
  const code = isOperational ? error.code : 'INTERNAL_ERROR';
  const message = isOperational ? error.message : 'Something went wrong on our end.';

  if (statusCode >= 500) {
    logger.error('unhandled error', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      code,
      errorMessage: error.message,
      stack: error.stack,
    });
  }

  const body = {
    success: false,
    error: { code, message },
    requestId: req.id,
  };

  if (isOperational && error.details) body.error.details = error.details;
  // Stack traces are a development aid only.
  if (!isOperational && !env.isProduction && !env.isTest) body.error.stack = error.stack;

  res.status(statusCode).json(body);
}
