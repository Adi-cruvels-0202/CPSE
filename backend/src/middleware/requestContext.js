import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger.js';

/**
 * A client may bring its own correlation id, but only a plausible one: it is
 * echoed in a header and written to every log line for this request, so its
 * shape is checked rather than trusted (checklist 10.4). Anything else is
 * replaced with a fresh uuid instead of being rejected — the request itself is
 * fine, only the label was wrong.
 */
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,64}$/;

/**
 * Attaches a request id to every request and echoes it back as `X-Request-Id`,
 * so a client-reported failure can be traced in the logs.
 */
export function requestContext(req, res, next) {
  const supplied = req.get('X-Request-Id');
  req.id = supplied && REQUEST_ID.test(supplied) ? supplied : randomUUID();
  req.startedAt = process.hrtime.bigint();
  res.setHeader('X-Request-Id', req.id);
  next();
}

/** Logs one line per completed request. No bodies, no headers, no PII. */
export function requestLogger(req, res, next) {
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - req.startedAt) / 1e6;
    const context = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    };

    if (res.statusCode >= 500) logger.error('request failed', context);
    else if (res.statusCode >= 400) logger.warn('request rejected', context);
    else logger.info('request completed', context);
  });
  next();
}
