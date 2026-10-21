import axios, { type AxiosError, type AxiosRequestConfig } from 'axios';
import { API_BASE, toApiError, type Meta } from '../api/client';
import type { Conversation, Verification } from '../api/ops';

/**
 * The platform reviewers' console (backend /admin — store verification and
 * escalated support). A reviewer is not a shop account, so the console keeps
 * its own session under its own key: signing in here never signs a merchant
 * out of the shop app in the same browser, or the other way round.
 */

const KEY = 'cpse.admin.session';

export interface AdminSession { accessToken: string; refreshToken: string }

export function readAdminSession(): AdminSession | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
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
    // Storage blocked: the reviewer signs in again next time.
  }
}

export const adminHttp = axios.create({ baseURL: API_BASE });

adminHttp.interceptors.request.use((config) => {
  const session = readAdminSession();
  if (session && !config.headers.Authorization) config.headers.Authorization = `Bearer ${session.accessToken}`;
  return config;
});

async function refresh(): Promise<boolean> {
  const session = readAdminSession();
  if (!session) return false;
  try {
    const res = await adminHttp.post('/auth/refresh', { refreshToken: session.refreshToken });
    writeAdminSession(res.data.data.session);
    return true;
  } catch {
    writeAdminSession(null);
    return false;
  }
}

async function send<T>(config: AxiosRequestConfig, retried = false): Promise<{ data: T; meta?: Meta }> {
  try {
    const res = await adminHttp.request(config);
    return { data: res.data.data, meta: res.data.meta };
  } catch (raw) {
    const error = raw as AxiosError<any>;
    if (error.response?.status === 401 && readAdminSession() && !retried && !String(config.url).includes('/auth/')) {
      if (await refresh()) {
        const { Authorization: _dropped, ...headers } = (config.headers ?? {}) as Record<string, string>;
        return send<T>({ ...config, headers }, true);
      }
    }
    throw toApiError(error);
  }
}

const get = async <T>(url: string, params?: Record<string, unknown>) => (await send<T>({ method: 'get', url, params })).data;
const post = async <T>(url: string, body: unknown = {}) => (await send<T>({ method: 'post', url, data: body })).data;
const patch = async <T>(url: string, body: unknown = {}) => (await send<T>({ method: 'patch', url, data: body })).data;

export type AdminRole = 'superadmin' | 'reviewer' | 'support';
export type Permission =
  | 'viewOverview' | 'viewStores' | 'viewAccounts' | 'viewLog' | 'reviewStores'
  | 'moderateStores' | 'handleSupport' | 'suspendAccounts' | 'manageAdmins';
export interface AdminMe { id: string; email: string; fullName: string | null; role: AdminRole; permissions: Permission[] }

export interface AdminAction {
  id: string; at: string; admin: { id: string | null; email: string }; action: string;
  target: { type: 'store' | 'account' | 'admin'; id: string | null; label: string | null }; reason: string | null; details: Record<string, unknown>;
}
export interface Overview {
  you: { id: string; email: string; role: AdminRole; permissions: Permission[] };
  stores: { total: number; published: number; waitingForReview: number; sentBack: number; waitingToPublish: number };
  accounts: { total: number; merchants: number; customers: number; suspended: number };
  support: { escalated: number };
  recentActions: AdminAction[];
}
export interface StoreOwner { id: string; email: string; name: string | null; phone: string | null; isSuspended: boolean }
export interface AdminStoreRow {
  id: string; name: string; slug: string; city: string | null; shopCategory: string | null; isPublished: boolean;
  verificationStatus: 'not_submitted' | 'pending' | 'verified' | 'rejected'; verificationLabel: string; publishRequestedAt: string | null;
  createdAt: string; owner: StoreOwner | null;
}
export interface AdminStoreDetail {
  store: AdminStoreRow & { phone: string | null; email: string | null; address: string; missingForPublish: string[] };
  counts: { products: number; orders: number; ordersLast30Days: number };
  actions: AdminAction[];
}
export interface AdminAccount {
  id: string; email: string; name: string | null; phone: string | null; createdAt: string; type: 'customer' | 'merchant' | 'admin';
  isSuspended: boolean; suspendedAt: string | null; suspendedReason: string | null; storeCount: number; orderCount: number;
}
export interface AdminAccountDetail { account: AdminAccount; adminRole: AdminRole | null; stores: AdminStoreRow[]; actions: AdminAction[] }
export interface AdminMember { id: string; email: string; name: string | null; role: AdminRole; addedAt: string; permissions: Permission[] }

export interface ReviewRow {
  storeId: string; name: string; slug: string; city: string | null; legalName: string | null;
  status: Verification['status']; statusLabel: string; isPublished: boolean; submittedAt: string | null;
}
export interface ReviewView {
  store: { id: string; name: string; slug: string; phone: string | null; email: string | null; address: string; isPublished: boolean; publishRequestedAt: string | null };
  verification: Verification;
  published?: boolean;
}

export const adminApi = {
  login: (email: string, password: string) =>
    post<{ admin: AdminMe; session: AdminSession }>('/admin/auth/login', { email, password }),
  me: () => get<{ admin: AdminMe }>('/admin/me'),
  overview: () => get<{ overview: Overview }>('/admin/overview'),
  stores: (params: { search?: string; verification?: string; published?: string; page?: number }) => send<{ stores: AdminStoreRow[] }>({ method: 'get', url: '/admin/stores', params }),
  store: (storeId: string) => get<AdminStoreDetail>(`/admin/stores/${storeId}`),
  unpublishStore: (storeId: string, reason: string) => post<AdminStoreDetail>(`/admin/stores/${storeId}/unpublish`, { reason }),
  accounts: (params: { search?: string; kind?: string; status?: string; page?: number }) => send<{ accounts: AdminAccount[] }>({ method: 'get', url: '/admin/accounts', params }),
  account: (accountId: string) => get<AdminAccountDetail>(`/admin/accounts/${accountId}`),
  suspend: (accountId: string, reason: string) => post<AdminAccountDetail>(`/admin/accounts/${accountId}/suspend`, { reason }),
  reinstate: (accountId: string, reason: string) => post<AdminAccountDetail>(`/admin/accounts/${accountId}/reinstate`, { reason }),
  admins: () => get<{ admins: AdminMember[]; roles: { role: AdminRole; permissions: Permission[] }[] }>('/admin/admins'),
  addAdmin: (email: string, role: AdminRole) => post<{ admin: AdminMember }>('/admin/admins', { email, role }),
  changeRole: (adminId: string, role: AdminRole) => patch<{ admin: AdminMember }>(`/admin/admins/${adminId}`, { role }),
  removeAdmin: (adminId: string, reason: string) => post<{ removed: string }>(`/admin/admins/${adminId}/remove`, { reason }),
  log: (params: { targetType?: string; page?: number }) => send<{ actions: AdminAction[] }>({ method: 'get', url: '/admin/log', params }),
  logout: () => post('/auth/logout'),
  queue: (params: { status?: string; page?: number }) => send<{ stores: ReviewRow[] }>({ method: 'get', url: '/admin/verifications', params }),
  review: (storeId: string) => get<ReviewView>(`/admin/verifications/${storeId}`),
  documentUrl: (storeId: string, documentId: string) => get<{ url: string; expiresInSeconds: number }>(`/admin/verifications/${storeId}/documents/${documentId}/url`),
  approve: (storeId: string, note?: string) => post<ReviewView>(`/admin/verifications/${storeId}/approve`, note ? { note } : {}),
  reject: (storeId: string, reason: string, note?: string) => post<ReviewView>(`/admin/verifications/${storeId}/reject`, { reason, ...(note ? { note } : {}) }),
  escalated: () => get<{ conversations: (Conversation & { store?: { id: string; name: string } })[] }>('/admin/support'),
  conversation: (id: string) => get<{ conversation: Conversation & { store?: { id: string; name: string } } }>(`/admin/support/${id}`),
  reply: (id: string, body: string, resolve = false) => post<{ conversation: Conversation }>(`/admin/support/${id}/messages`, { body, resolve }),
};
