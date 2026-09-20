import { readSession, writeSession, clearSession } from './tokens.js';

/**
 * The one way this app talks to the backend.
 *
 * It knows four things no screen should have to:
 *
 *   1. the envelope. Every response is `{ success, data, meta }` or
 *      `{ success: false, error, requestId }`, so callers get `data` and a
 *      thrown ApiError, never a shape to inspect.
 *   2. the bearer token, attached when there is one and omitted when there is
 *      not — public store pages must work with no session at all.
 *   3. refresh. A 401 on a request that carried a token means the access token
 *      expired; the pair is rotated once and the request replayed, so a shopper
 *      mid-checkout does not get bounced to a login screen.
 *   4. that a network failure and a 500 are different things, and a customer
 *      needs to be told which.
 *
 * Nothing here formats a message for display. `ApiError.code` is what a screen
 * switches on; `ApiError.message` is the server's own wording, which is written
 * for the customer (see backend docs/API.md).
 */

const BASE_URL = (import.meta.env?.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(
  /\/+$/,
  '',
);

export class ApiError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? null;
    /** Echoed by the backend on every response — quote it in a bug report. */
    this.requestId = requestId ?? null;
  }

  /** Field errors from a 422, as `{ fieldName: message }`. */
  get fieldErrors() {
    const issues = this.details?.issues;
    if (!Array.isArray(issues)) return {};

    const map = {};
    for (const issue of issues) {
      // First message per field: a form shows one error under an input.
      if (issue?.field && !map[issue.field]) map[issue.field] = issue.message;
    }
    return map;
  }

  get isValidation() {
    return this.status === 422;
  }

  get isUnauthorized() {
    return this.status === 401;
  }

  get isNotFound() {
    return this.status === 404;
  }

  /** True when retrying the same request might work. */
  get isTransient() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

/** A failure with no HTTP response at all: offline, DNS, a refused connection. */
const networkError = (cause) =>
  new ApiError({
    status: 0,
    code: 'NETWORK_ERROR',
    message: 'Could not reach the server. Check your connection and try again.',
    details: { cause: cause?.message ?? String(cause) },
  });

function buildUrl(path, query) {
  const url = new URL(`${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    // An absent filter must not become `?status=undefined`, which the backend
    // rejects as an unknown value rather than ignoring.
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * One in-flight refresh at a time. Without this, five requests failing together
 * would fire five refreshes, and four of them would present a refresh token the
 * first rotation had already invalidated — signing the customer out for having
 * a fast connection.
 */
let refreshInFlight = null;

async function refreshSession() {
  const session = readSession();
  if (!session?.refreshToken) return null;

  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        // The refresh token is spent or revoked. This is a real sign-out, and
        // the auth context is told through the session listener.
        clearSession();
        return null;
      }
      return writeSession(body.data.session);
    } catch {
      // A network failure is NOT a sign-out: the token may still be good once
      // the connection is back, so the session is left alone.
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function parse(response) {
  if (response.status === 204) return { data: null, meta: null };

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError({
      status: response.status,
      code: body?.error?.code ?? 'UNKNOWN_ERROR',
      message: body?.error?.message ?? 'Something went wrong. Please try again.',
      details: body?.error?.details,
      requestId: body?.requestId ?? response.headers.get('x-request-id'),
    });
  }

  return { data: body?.data ?? null, meta: body?.meta ?? null };
}

/**
 * `auth: 'required' | 'optional' | 'none'`
 *
 *   required  a token is attached, and a 401 triggers one refresh and a replay.
 *   optional  a token is attached when there is one — public store pages that
 *             personalise. A 401 is NOT retried: the page works signed out.
 *   none      no token, ever. Login, register, the password-reset pair.
 */
export async function request(
  path,
  { method = 'GET', body, query, auth = 'required', idempotencyKey, signal } = {},
) {
  const send = async (token) => {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

    try {
      return await fetch(buildUrl(path, query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (cause) {
      // An aborted request is the caller's own doing — let it through as-is so a
      // component unmounting does not surface as a network error.
      if (cause?.name === 'AbortError') throw cause;
      throw networkError(cause);
    }
  };

  const token = auth === 'none' ? null : readSession()?.accessToken ?? null;
  let response = await send(token);

  // Refresh and replay, once. Only when we actually sent a token: a 401 with no
  // token is the correct answer to "sign in first", not an expiry.
  if (response.status === 401 && token && auth === 'required') {
    const refreshed = await refreshSession();
    if (refreshed?.accessToken) response = await send(refreshed.accessToken);
  }

  return parse(response);
}

/** `data` only, for the majority of calls that do not read pagination. */
export async function requestData(path, options) {
  const { data } = await request(path, options);
  return data;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};

export { BASE_URL };
