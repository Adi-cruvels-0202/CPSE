import { validationFailed } from '../lib/errors.js';

/**
 * Builds a middleware that validates parts of the request against Zod schemas
 * and REPLACES them with the parsed result — so handlers only ever see data
 * that has been coerced, trimmed and stripped of unknown keys.
 *
 *   router.post('/', validate({ body: createAddressSchema }), handler)
 *
 * Spec §16: every identifier, quantity and money field is validated server-side.
 */
export function validate(schemas) {
  return function validateRequest(req, res, next) {
    const issues = [];
    const parsed = {};

    for (const source of ['params', 'query', 'body']) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (result.success) {
        parsed[source] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({
            source,
            field: issue.path.join('.') || source,
            message: issue.message,
          });
        }
      }
    }

    if (issues.length > 0) return next(validationFailed({ issues }));

    // `req.query` is a getter on newer Express versions, so assign safely.
    for (const [source, value] of Object.entries(parsed)) {
      Object.defineProperty(req, source, { value, writable: true, configurable: true });
    }

    return next();
  };
}
