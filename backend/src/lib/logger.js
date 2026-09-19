import { env } from '../config/env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * Keys whose values are replaced with '[redacted]' before anything is logged —
 * checklist 10.4.
 *
 * Two groups, and the distinction matters when reading a log:
 *   credentials, which must never be written anywhere, at all; and
 *   personal data, which is not a secret but has no business in an operational
 *   log either. A request id plus a customer id is enough to find a person in
 *   the database when there is a real reason to; their phone number in a log
 *   line only widens who can read it.
 */
const REDACTED_KEYS = new Set([
  // Credentials and secrets.
  'password',
  'newpassword',
  'currentpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'apikey',
  'secret',
  'servicerolekey',
  'webhooksecret',
  'signature',
  'cardnumber',
  'cvv',
  'otp',
  'idempotencykey',
  // Personal data (identify people by id, not by contact details).
  'email',
  'phone',
  'recipientname',
  'fullname',
  'line1',
  'line2',
  'landmark',
  'postalcode',
  'latitude',
  'longitude',
  'deliveryaddress',
]);

/**
 * A single value is capped before it is written. A log line whose length a
 * caller controls is a log line a caller can use to bury the ones around it.
 */
const MAX_VALUE_LENGTH = 512;

const truncate = (value) =>
  typeof value === 'string' && value.length > MAX_VALUE_LENGTH
    ? `${value.slice(0, MAX_VALUE_LENGTH)}…[truncated ${value.length} chars]`
    : value;

function redact(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase())
      ? '[redacted]'
      : truncate(redact(val, depth + 1));
  }
  return out;
}

function write(level, message, context) {
  if (LEVELS[level] < LEVELS[env.LOG_LEVEL]) return;

  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? redact(context) : {}),
  };

  const line = env.isProduction ? JSON.stringify(entry) : JSON.stringify(entry, null, 2);
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (message, context) => write('debug', message, context),
  info: (message, context) => write('info', message, context),
  warn: (message, context) => write('warn', message, context),
  error: (message, context) => write('error', message, context),
};
