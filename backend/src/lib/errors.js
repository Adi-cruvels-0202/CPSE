/**
 * Every error the API returns deliberately is an AppError.
 * Anything else that reaches the error handler is treated as an unexpected 500
 * and its details are never leaked to the client.
 */
export class AppError extends Error {
  /**
   * @param {number} statusCode HTTP status
   * @param {string} code stable machine-readable code, e.g. 'NOT_FOUND'
   * @param {string} message human-readable message, safe to show the user
   * @param {object} [details] extra structured context (field errors, etc.)
   */
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, AppError);
  }
}

/**
 * Ownership rule (spec §16): when a resource exists but belongs to someone else
 * we return 404, not 403 — a 403 would confirm the resource exists.
 */
export const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
export const validationFailed = (details) =>
  new AppError(422, 'VALIDATION_FAILED', 'The request did not pass validation.', details);
export const unauthorized = (message = 'Authentication is required.') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You are not allowed to perform this action.') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (resource = 'Resource') =>
  new AppError(404, 'NOT_FOUND', `${resource} was not found.`);
export const conflict = (message, details) => new AppError(409, 'CONFLICT', message, details);
export const unprocessable = (code, message, details) => new AppError(422, code, message, details);
export const tooManyRequests = (message = 'Too many requests. Please try again later.') =>
  new AppError(429, 'RATE_LIMITED', message);
export const internal = (message = 'Something went wrong on our end.') =>
  new AppError(500, 'INTERNAL_ERROR', message);
export const serviceUnavailable = (message = 'An upstream service is unavailable.') =>
  new AppError(503, 'SERVICE_UNAVAILABLE', message);
