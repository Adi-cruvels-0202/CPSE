import { readSession, writeSession, clearSession } from '@/merchant/lib/session';

/**
 * The merchant API client. Same contract as the original axios client
 * (bearer from the merchant session, one shared refresh on 401, envelope
 * unwrapping, ApiError with field errors) — written on fetch so the
 * redesign needs no extra HTTP dependency.
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

  get fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const issue of this.details?.issues ?? []) {
      if (issue?.field && !map[issue.field]) map[issue.field] = issue.message;
    }
    return map;
  }
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.') {
  if (error instanceof ApiError) {
    const fields = Object.values(error.fieldErrors);
    return error.code === 'VALIDATION_FAILED' && fields.length > 0 ? fields[0] : error.message;
  }
  return fallback;
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

let refreshing: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    const session = readSession();
    refreshing = (async () => {
      if (!session) return false;
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        });
        if (!res.ok) throw new Error('refresh failed');
        const body = await res.json();
        writeSession(body.data.session);
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

function clean(params?: Record<string, unknown>) {
  if (!params) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === null) continue;
    if (Array.isArray(value)) value.forEach((v) => qs.append(`${key}[]`, String(v)));
    else qs.append(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

interface Req {
  method: string;
  url: string;
  params?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: 'text';
}

async function rawRequest(req: Req, withAuth: boolean) {
  const headers: Record<string, string> = { Accept: 'application/json', ...(req.headers ?? {}) };
  const session = readSession();
  if (withAuth && session && !headers.Authorization) headers.Authorization = `Bearer ${session.accessToken}`;
  let body: BodyInit | undefined;
  if (req.body instanceof FormData) body = req.body;
  else if (typeof req.body === 'string') body = req.body;
  else if (req.body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    body = JSON.stringify(req.body);
  }
  try {
    return await fetch(`${API_BASE}${req.url}${clean(req.params)}`, { method: req.method.toUpperCase(), headers, body });
  } catch {
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'Could not reach the server. Check your connection and try again.' });
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  return new ApiError({
    status: res.status,
    code: body?.error?.code ?? 'UNKNOWN',
    message: body?.error?.message ?? 'The server could not complete that request.',
    details: body?.error?.details,
    requestId: body?.requestId ?? null,
  });
}

async function send<T>(req: Req, retried = false): Promise<Page<T>> {
  const res = await rawRequest(req, true);
  if (!res.ok) {
    const hadToken = Boolean(readSession());
    if (res.status === 401 && hadToken && !retried && !req.url.startsWith('/auth/')) {
      if (await refreshSession()) return send<T>(req, true);
    }
    throw await toApiError(res);
  }
  if (res.status === 204) return { data: undefined as T };
  const json = await res.json().catch(() => ({}));
  return { data: json.data, meta: json.meta };
}

export const api = {
  get: async <T>(url: string, params?: Record<string, unknown>) => (await send<T>({ method: 'get', url, params })).data,
  page: <T>(url: string, params?: Record<string, unknown>) => send<T>({ method: 'get', url, params }),
  post: async <T>(url: string, body?: unknown, headers?: Record<string, string>) =>
    (await send<T>({ method: 'post', url, body: body ?? {}, headers })).data,
  patch: async <T>(url: string, body: unknown) => (await send<T>({ method: 'patch', url, body })).data,
  put: async <T>(url: string, body: unknown) => (await send<T>({ method: 'put', url, body })).data,
  delete: async <T>(url: string, body?: unknown) => (await send<T>({ method: 'delete', url, body })).data,
  text: async <T>(url: string, text: string, params?: Record<string, unknown>, contentType = 'text/csv') =>
    (await send<T>({ method: 'post', url, body: text, params, headers: { 'Content-Type': contentType } })).data,
  download: async (url: string): Promise<string> => {
    let res = await rawRequest({ method: 'get', url }, true);
    if (res.status === 401 && (await refreshSession())) res = await rawRequest({ method: 'get', url }, true);
    if (!res.ok) throw await toApiError(res);
    return res.text();
  },
  upload: async <T>(url: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return (await send<T>({ method: 'post', url, body: form })).data;
  },
};
