/**
 * Every endpoint returns one of exactly two envelopes, so the frontend
 * never has to guess at a response shape.
 *
 *   success: { success: true,  data: <payload>, meta?: {...} }
 *   failure: { success: false, error: { code, message, details? }, requestId }
 */

export function sendSuccess(res, data, { status = 200, meta } = {}) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

export function sendCreated(res, data, options = {}) {
  return sendSuccess(res, data, { ...options, status: 201 });
}

export function sendNoContent(res) {
  return res.status(204).end();
}

/**
 * Pagination meta used by every list endpoint.
 */
export function paginationMeta({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
    hasNextPage: page * limit < total,
  };
}
