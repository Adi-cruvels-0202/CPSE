import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { readSession, writeSession, clearSession } from '../lib/session';

/**
 * The one way this app talks to the backend (backend docs/API.md).
 *
 *   - Same origin: the backend serves this app, so `/api/v1` needs no host and
 *     no CORS. In standalone dev, Vite proxies it (vite.config.ts).
 *   - The envelope `{ success, data, meta }` is unwrapped here: callers get
 *     `data` (and `meta` when they ask for it), never the envelope.
 *   - A 401 on a request that carried a token rotates the session once and
 *     replays the request; several failing together share one refresh.
 *   - Failures become an ApiError with the server's own `code` and `message`
 *     (written to be shown), plus field errors from a 422.
 */

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  status: number;
  code: string;
  details: any;
  requestId: string | null;

  constructor({ status, code, message, details, requestId }: { status: number; code: string; message: string; details?: any; requestId?: string | null }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? null;
    this.requestId = requestId ?? null;
  }

  /** A 422's issues as `{ field: message }`, first message per field. */
  get fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const issue of this.details?.issues ?? []) {
      if (issue?.field && !map[issue.field]) map[issue.field] = issue.message;
    }
    return map;
  }
}

/** Whatever was thrown, as something a person can read. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.') {
  if (error instanceof ApiError) {
    const fields = Object.values(error.fieldErrors);
    // "Request validation failed" says less than the first field's reason.
    return error.code === 'VALIDATION_FAILED' && fields.length > 0 ? fields[0] : error.message;
  }
  return fallback;
}

/** Exported for tests, which give it a fake transport; screens use `api`. */
export const http = axios.create({ baseURL: API_BASE });

http.interceptors.request.use((config) => {
  const session = readSession();
  if (session && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return config;
});

let refreshing: Promise<boolean> | null = null;

/** Rotates the pair once, shared by every request that hit 401 together. */
function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    const session = readSession();
    refreshing = (async () => {
      if (!session) return false;
      try {
        const res = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken: session.refreshToken });
        writeSession(res.data.data.session);
        return true;
      } catch {
        clearSession();
        return false;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

function toApiError(error: AxiosError<any>): ApiError {
  if (!error.response) {
    return new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'Could not reach the server. Check your connection and try again.' });
  }
  const body = error.response.data;
  return new ApiError({
    status: error.response.status,
    code: body?.error?.code ?? 'UNKNOWN',
    message: body?.error?.message ?? 'The server could not complete that request.',
    details: body?.error?.details,
    requestId: body?.requestId ?? null,
  });
}

export interface Meta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
}

export interface Page<T> {
  data: T;
  meta?: Meta;
}

async function send<T>(config: AxiosRequestConfig, retried = false): Promise<Page<T>> {
  try {
    const res = await http.request(config);
    // A 204 has no body.
    return res.status === 204 ? { data: undefined as T } : { data: res.data.data, meta: res.data.meta };
  } catch (raw) {
    const error = raw as AxiosError<any>;
    const hadToken = Boolean(readSession());
    if (error.response?.status === 401 && hadToken && !retried && !String(config.url).startsWith('/auth/')) {
      if (await refreshSession()) {
        const { Authorization: _dropped, ...headers } = (config.headers ?? {}) as Record<string, string>;
        return send<T>({ ...config, headers }, true);
      }
    }
    throw toApiError(error);
  }
}

/** Drops undefined and empty-string query params, so `?status=` is never sent. */
function clean(params?: Record<string, unknown>) {
  if (!params) return undefined;
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== ''));
}

export const api = {
  get: async <T>(url: string, params?: Record<string, unknown>) => (await send<T>({ method: 'get', url, params: clean(params) })).data,
  /** A list endpoint, with its pagination `meta`. */
  page: <T>(url: string, params?: Record<string, unknown>) => send<T>({ method: 'get', url, params: clean(params) }),
  post: async <T>(url: string, body?: unknown, headers?: Record<string, string>) =>
    (await send<T>({ method: 'post', url, data: body ?? {}, headers })).data,
  patch: async <T>(url: string, body: unknown) => (await send<T>({ method: 'patch', url, data: body })).data,
  put: async <T>(url: string, body: unknown) => (await send<T>({ method: 'put', url, data: body })).data,
  delete: async <T>(url: string, body?: unknown) => (await send<T>({ method: 'delete', url, data: body })).data,
  /** One file, as the multipart field `file`. */
  upload: async <T>(url: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return (await send<T>({ method: 'post', url, data: form })).data;
  },
};
