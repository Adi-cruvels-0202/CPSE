/**
 * Wraps an async route handler so a rejected promise reaches the central
 * error middleware instead of hanging the request.
 *
 *   router.get('/', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
