import { API_BASE, ApiError, type Meta } from "@/merchant/api/client";
import type { Conversation, Verification } from "@/merchant/api/ops";

/**
 * The platform admin console (backend /admin). An admin is not a shop
 * account, so the console keeps its own session under its own key: signing
 * in here never signs a merchant out of the shop app in the same browser, or
 * the other way round. Same key as the original console, so one sign-in
 * covers both.
 */

const KEY = "cpse.admin.session";

export interface AdminSession { accessToken: string; refreshToken: string }

export function readAdminSession(): AdminSession | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    return parsed?.accessToken && parsed?.refreshToken ? parsed : null;
  } catch {
    return null;
  }
}

export function writeAdminSession(session: AdminSession | null) {
  try {
    if (session) window.localStorage.setItem(KEY, JSON.stringify({ accessToken: session.accessToken, refreshToken: session.refreshToken }));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the admin signs in again next time.
  }
}

type Req = { method: "get" | "post"; url: string; params?: Record<string, unknown>; body?: unknown };

function query(params?: Record<string, unknown>) {
  if (!params) return "";
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

async function raw(req: Req) {
  const headers: Record<string, string> = { Accept: "application/json" };
  const session = readAdminSession();
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  if (req.body !== undefined) headers["Content-Type"] = "application/json";
  try {
    return await fetch(`${API_BASE}${req.url}${query(req.params)}`, {
      method: req.method.toUpperCase(),
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
    });
  } catch {
    throw new ApiError({ status: 0, code: "NETWORK_ERROR", message: "Could not reach the server. Check your connection and try again." });
  }
}

async function toError(res: Response) {
  const body = await res.json().catch(() => null);
  return new ApiError({
    status: res.status,
    code: body?.error?.code ?? "UNKNOWN",
    message: body?.error?.message ?? "The server could not complete that request.",
    details: body?.error?.details,
    requestId: body?.requestId ?? null,
  });
}

async function refresh(): Promise<boolean> {
  const session = readAdminSession();
  if (!session) return false;
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  }).catch(() => null);
  if (!res?.ok) {
    writeAdminSession(null);
    return false;
  }
  const json = await res.json().catch(() => null);
  if (!json?.data?.session) {
    writeAdminSession(null);
    return false;
  }
  writeAdminSession(json.data.session);
  return true;
}

async function send<T>(req: Req, retried = false): Promise<{ data: T; meta?: Meta }> {
  const res = await raw(req);
  if (!res.ok) {
    if (res.status === 401 && readAdminSession() && !retried && !req.url.includes("/auth/")) {
      if (await refresh()) return send<T>(req, true);
    }
    throw await toError(res);
  }
  const json = await res.json().catch(() => ({}));
  return { data: json.data, meta: json.meta };
}

const get = async <T>(url: string, params?: Record<string, unknown>) => (await send<T>({ method: "get", url, params })).data;
const post = async <T>(url: string, body: unknown = {}) => (await send<T>({ method: "post", url, body })).data;

export interface AdminMe { id: string; email: string; fullName: string | null }

export interface AdminAction {
  id: string; at: string; admin: { id: string | null; email: string }; action: string;
  target: { type: "store" | "account" | "admin"; id: string | null; label: string | null }; reason: string | null; details: Record<string, unknown>;
}
export interface Overview {
  you: { id: string; email: string };
  stores: { total: number; published: number; waitingForReview: number; sentBack: number; waitingToPublish: number };
  accounts: { total: number; merchants: number; customers: number; suspended: number };
  support: { escalated: number };
  recentActions: AdminAction[];
}
export interface StoreOwner { id: string; email: string; name: string | null; phone: string | null; isSuspended: boolean }
export interface AdminStoreRow {
  id: string; name: string; slug: string; city: string | null; shopCategory: string | null; isPublished: boolean;
  verificationStatus: "not_submitted" | "pending" | "verified" | "rejected"; verificationLabel: string; publishRequestedAt: string | null;
  createdAt: string; owner: StoreOwner | null;
}
export interface AdminStoreDetail {
  store: AdminStoreRow & { phone: string | null; email: string | null; address: string; missingForPublish: string[] };
  counts: { products: number; orders: number; ordersLast30Days: number };
  actions: AdminAction[];
}
export interface AdminAccount {
  id: string; email: string; name: string | null; phone: string | null; createdAt: string; type: "customer" | "merchant" | "admin";
  isSuspended: boolean; suspendedAt: string | null; suspendedReason: string | null; storeCount: number; orderCount: number;
}
export interface AdminAccountDetail { account: AdminAccount; stores: AdminStoreRow[]; actions: AdminAction[] }

export interface ReviewRow {
  storeId: string; name: string; slug: string; city: string | null; legalName: string | null;
  status: Verification["status"]; statusLabel: string; isPublished: boolean; submittedAt: string | null;
}
export interface ReviewView {
  store: { id: string; name: string; slug: string; phone: string | null; email: string | null; address: string; isPublished: boolean; publishRequestedAt: string | null };
  verification: Verification;
  published?: boolean;
}

export const adminApi = {
  login: (email: string, password: string) =>
    post<{ admin: AdminMe; session: AdminSession }>("/admin/auth/login", { email, password }),
  me: () => get<{ admin: AdminMe }>("/admin/me"),
  overview: () => get<{ overview: Overview }>("/admin/overview"),
  stores: (params: { search?: string; verification?: string; published?: string; page?: number }) => send<{ stores: AdminStoreRow[] }>({ method: "get", url: "/admin/stores", params }),
  store: (storeId: string) => get<AdminStoreDetail>(`/admin/stores/${storeId}`),
  unpublishStore: (storeId: string, reason: string) => post<AdminStoreDetail>(`/admin/stores/${storeId}/unpublish`, { reason }),
  accounts: (params: { search?: string; kind?: string; status?: string; page?: number }) => send<{ accounts: AdminAccount[] }>({ method: "get", url: "/admin/accounts", params }),
  account: (accountId: string) => get<AdminAccountDetail>(`/admin/accounts/${accountId}`),
  suspend: (accountId: string, reason: string) => post<AdminAccountDetail>(`/admin/accounts/${accountId}/suspend`, { reason }),
  reinstate: (accountId: string, reason: string) => post<AdminAccountDetail>(`/admin/accounts/${accountId}/reinstate`, { reason }),
  log: (params: { targetType?: string; page?: number }) => send<{ actions: AdminAction[] }>({ method: "get", url: "/admin/log", params }),
  logout: () => post("/auth/logout"),
  queue: (params: { status?: string; page?: number }) => send<{ stores: ReviewRow[] }>({ method: "get", url: "/admin/verifications", params }),
  review: (storeId: string) => get<ReviewView>(`/admin/verifications/${storeId}`),
  documentUrl: (storeId: string, documentId: string) => get<{ url: string; expiresInSeconds: number }>(`/admin/verifications/${storeId}/documents/${documentId}/url`),
  approve: (storeId: string, note?: string) => post<ReviewView>(`/admin/verifications/${storeId}/approve`, note ? { note } : {}),
  reject: (storeId: string, reason: string, note?: string) => post<ReviewView>(`/admin/verifications/${storeId}/reject`, { reason, ...(note ? { note } : {}) }),
  escalated: () => get<{ conversations: (Conversation & { store?: { id: string; name: string } })[] }>("/admin/support"),
  conversation: (id: string) => get<{ conversation: Conversation & { store?: { id: string; name: string } } }>(`/admin/support/${id}`),
  reply: (id: string, body: string, resolve = false) => post<{ conversation: Conversation }>(`/admin/support/${id}/messages`, { body, resolve }),
};
