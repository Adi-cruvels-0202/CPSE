import { api } from './client';
import type {
  Merchant,
  StoreSummary,
  Store,
  Holiday,
  Category,
  Product,
  StockVariant,
  LedgerEntry,
  Order,
  Sale,
  Dashboard,
  OpeningHours,
} from './types';

/**
 * Every backend call, named — the mirror of backend docs/API.md. Screens call
 * these, never `api` directly, so a path lives in exactly one place.
 */

type Session = { accessToken: string; refreshToken: string; expiresAt?: number | null };

export const authApi = {
  login: (body: { email: string; password: string }) =>
    api.post<{ session: Session; roles: string[] }>('/auth/login', body),
  logout: () => api.post<void>('/auth/logout'),
  forgotPassword: (email: string) => api.post<{ message: string }>('/auth/forgot-password', { email }),
};

export const merchantApi = {
  register: (body: { email: string; password: string; fullName: string; phone?: string }) =>
    api.post<{ merchant: Merchant | null; session: Session | null; emailConfirmationRequired: boolean }>('/merchant/auth/register', body),
  /** The shop sign-in: a customer account is refused (403 CUSTOMER_ACCOUNT). */
  login: (body: { email: string; password: string }) =>
    api.post<{ merchant: Merchant; session: Session; roles: string[] }>('/merchant/auth/login', body),
  me: () => api.get<{ merchant: Merchant; stores: StoreSummary[] }>('/merchant/me'),
  updateMe: (body: { fullName?: string; phone?: string | null }) => api.patch<{ merchant: Merchant }>('/merchant/me', body),
};

const store = (storeId: string) => `/merchant/stores/${storeId}`;

export const storeApi = {
  list: () => api.get<{ stores: Store[] }>('/merchant/stores'),
  get: (storeId: string) => api.get<{ store: Store }>(store(storeId)),
  create: (body: Record<string, unknown>) => api.post<{ store: Store }>('/merchant/stores', body),
  update: (storeId: string, body: Record<string, unknown>) => api.patch<{ store: Store }>(store(storeId), body),
  /** Permanent. `confirmName` is the store's name, typed by the merchant. */
  remove: (storeId: string, confirmName: string) => api.delete<void>(store(storeId), { confirmName }),
  publish: (storeId: string) => api.post<{ store: Store }>(`${store(storeId)}/publish`),
  unpublish: (storeId: string) => api.post<{ store: Store }>(`${store(storeId)}/unpublish`),
  setHours: (storeId: string, body: { timezone: string; openingHours: OpeningHours }) =>
    api.put<{ store: Store }>(`${store(storeId)}/hours`, body),
  setDelivery: (storeId: string, body: Record<string, unknown>) => api.put<{ store: Store }>(`${store(storeId)}/delivery`, body),
  setPayments: (storeId: string, body: { cash: boolean; online: boolean }) =>
    api.put<{ store: Store }>(`${store(storeId)}/payments`, body),
  uploadLogo: (storeId: string, file: File) => api.upload<{ store: Store }>(`${store(storeId)}/logo`, file),
  uploadCover: (storeId: string, file: File) => api.upload<{ store: Store }>(`${store(storeId)}/cover`, file),
  holidays: (storeId: string) => api.get<{ holidays: Holiday[] }>(`${store(storeId)}/holidays`),
  addHoliday: (storeId: string, body: { date: string; reason?: string }) =>
    api.post<{ holiday: Holiday }>(`${store(storeId)}/holidays`, body),
  removeHoliday: (storeId: string, holidayId: string) => api.delete<void>(`${store(storeId)}/holidays/${holidayId}`),
};

export const categoryApi = {
  list: (storeId: string) => api.get<{ categories: Category[] }>(`${store(storeId)}/categories`),
  create: (storeId: string, body: { name: string; description?: string | null }) =>
    api.post<{ category: Category }>(`${store(storeId)}/categories`, body),
  update: (storeId: string, id: string, body: { name?: string; description?: string | null }) =>
    api.patch<{ category: Category }>(`${store(storeId)}/categories/${id}`, body),
  activate: (storeId: string, id: string) => api.post<{ category: Category }>(`${store(storeId)}/categories/${id}/activate`),
  deactivate: (storeId: string, id: string) => api.post<{ category: Category }>(`${store(storeId)}/categories/${id}/deactivate`),
};

const product = (storeId: string, productId: string) => `${store(storeId)}/products/${productId}`;

export const productApi = {
  list: (storeId: string, params: Record<string, unknown> = {}) =>
    api.page<{ products: Product[] }>(`${store(storeId)}/products`, params),
  /** Every product, a page at a time — for screens that pick from the whole catalogue. */
  all: async (storeId: string) => {
    const products: Product[] = [];
    for (let page = 1; ; page += 1) {
      const { data, meta } = await productApi.list(storeId, { page, limit: 100 });
      products.push(...data.products);
      if (!meta?.hasNextPage) return products;
    }
  },
  get: (storeId: string, productId: string) => api.get<{ product: Product }>(product(storeId, productId)),
  create: (storeId: string, body: Record<string, unknown>) => api.post<{ product: Product }>(`${store(storeId)}/products`, body),
  update: (storeId: string, productId: string, body: Record<string, unknown>) =>
    api.patch<{ product: Product }>(product(storeId, productId), body),
  activate: (storeId: string, productId: string) => api.post<{ product: Product }>(`${product(storeId, productId)}/activate`),
  deactivate: (storeId: string, productId: string) => api.post<{ product: Product }>(`${product(storeId, productId)}/deactivate`),
  /** Archives the product: it leaves every list; past orders keep it. */
  remove: (storeId: string, productId: string) => api.delete<void>(product(storeId, productId)),
  addVariant: (storeId: string, productId: string, body: Record<string, unknown>) =>
    api.post<{ product: Product }>(`${product(storeId, productId)}/variants`, body),
  updateVariant: (storeId: string, productId: string, variantId: string, body: Record<string, unknown>) =>
    api.patch<{ product: Product }>(`${product(storeId, productId)}/variants/${variantId}`, body),
  setVariantActive: (storeId: string, productId: string, variantId: string, active: boolean) =>
    api.post<{ product: Product }>(`${product(storeId, productId)}/variants/${variantId}/${active ? 'activate' : 'deactivate'}`),
  uploadImage: (storeId: string, productId: string, file: File) =>
    api.upload<{ product: Product }>(`${product(storeId, productId)}/images`, file),
  deleteImage: (storeId: string, productId: string, imageId: string) =>
    api.delete<{ product: Product }>(`${product(storeId, productId)}/images/${imageId}`),
};

type Movement = { variant: StockVariant; entry: LedgerEntry };

export const inventoryApi = {
  stockIn: (storeId: string, body: { variantId: string; quantity: number; unitCostPaise?: number | null; notes?: string | null }) =>
    api.post<Movement>(`${store(storeId)}/inventory/stock-in`, body),
  stockOut: (storeId: string, body: { variantId: string; quantity: number; reason: string; notes?: string | null }) =>
    api.post<Movement>(`${store(storeId)}/inventory/stock-out`, body),
  adjust: (storeId: string, body: { variantId: string; newQuantity: number; reason: string }) =>
    api.post<Movement>(`${store(storeId)}/inventory/adjust`, body),
  history: (storeId: string, params: Record<string, unknown> = {}) =>
    api.page<{ entries: LedgerEntry[] }>(`${store(storeId)}/inventory/history`, params),
};

export const orderApi = {
  list: (storeId: string, params: Record<string, unknown> = {}) =>
    api.page<{ orders: Order[]; counts: Record<string, number> }>(`${store(storeId)}/orders`, params),
  get: (storeId: string, orderId: string) => api.get<{ order: Order }>(`${store(storeId)}/orders/${orderId}`),
  /** `action` is one of the order's `allowedActions`, e.g. "accept" or "status:preparing". */
  act: (storeId: string, orderId: string, action: string, reason?: string) => {
    const base = `${store(storeId)}/orders/${orderId}`;
    if (action.startsWith('status:')) return api.post<{ order: Order }>(`${base}/status`, { status: action.slice(7) });
    if (action === 'reject') return api.post<{ order: Order }>(`${base}/reject`, reason ? { reason } : {});
    if (action === 'cancel') return api.post<{ order: Order }>(`${base}/cancel`, { reason });
    return api.post<{ order: Order }>(`${base}/${action}`);
  },
};

export const saleApi = {
  create: (storeId: string, body: Record<string, unknown>, idempotencyKey: string) =>
    api.post<{ sale: Sale; replayed: boolean }>(`${store(storeId)}/sales`, body, { 'Idempotency-Key': idempotencyKey }),
  list: (storeId: string, params: Record<string, unknown> = {}) => api.page<{ sales: Sale[] }>(`${store(storeId)}/sales`, params),
  get: (storeId: string, saleId: string) => api.get<{ sale: Sale }>(`${store(storeId)}/sales/${saleId}`),
};

export const dashboardApi = {
  get: (storeId: string) => api.get<{ dashboard: Dashboard }>(`${store(storeId)}/dashboard`),
};
