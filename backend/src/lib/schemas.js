import { z } from 'zod';

/**
 * For a POST that carries no body at all — logout, save a store, mark a
 * notification read, reorder, set an address as default.
 *
 * Decision D20 says request schemas are `.strict()`, because silently dropping
 * an unknown field hides a client bug. A route with no body schema at all was
 * the one place that rule did not reach: it accepted `{"quantity": 99}` and
 * ignored it, which looks to the caller exactly like it worked. This makes
 * "takes no body" an explicit, enforced contract rather than an omission.
 *
 * An absent body is fine; a body with anything in it is a 422.
 */
export const emptyBody = z.object({}).strict();
