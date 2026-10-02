import api from './client';

// ========== Auth API ==========
export const authApi = {
  register: (data: { name: string; email: string; password: string }) =>
    api.post('/api/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post('/api/auth/login', data),
  me: () => api.get('/api/auth/me'),
};

// ========== Store API ==========
export const storeApi = {
  create: (data: any) => api.post('/api/stores', data),
  list: () => api.get('/api/stores'),
  get: (id: string) => api.get(`/api/stores/${id}`),
  update: (id: string, data: any) => api.put(`/api/stores/${id}`, data),
  publish: (id: string) => api.patch(`/api/stores/${id}/publish`),
  unpublish: (id: string) => api.patch(`/api/stores/${id}/unpublish`),
  getHours: (id: string) => api.get(`/api/stores/${id}/hours`),
  updateHours: (id: string, data: any) => api.put(`/api/stores/${id}/hours`, data),
  getHolidays: (id: string) => api.get(`/api/stores/${id}/holidays`),
  addHoliday: (id: string, data: any) => api.post(`/api/stores/${id}/holidays`, data),
  deleteHoliday: (id: string, holidayId: string) => api.delete(`/api/stores/${id}/holidays/${holidayId}`),
  getDelivery: (id: string) => api.get(`/api/stores/${id}/delivery`),
  updateDelivery: (id: string, data: any) => api.put(`/api/stores/${id}/delivery`, data),
  getPayments: (id: string) => api.get(`/api/stores/${id}/payments`),
  updatePayments: (id: string, data: any) => api.put(`/api/stores/${id}/payments`, data),
  uploadLogo: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/api/stores/${id}/logo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  uploadCover: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/api/stores/${id}/cover`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ========== Category API ==========
export const categoryApi = {
  list: (storeId: string) => api.get(`/api/stores/${storeId}/categories`),
  get: (storeId: string, id: string) => api.get(`/api/stores/${storeId}/categories/${id}`),
  create: (storeId: string, data: any) => api.post(`/api/stores/${storeId}/categories`, data),
  update: (storeId: string, id: string, data: any) => api.put(`/api/stores/${storeId}/categories/${id}`, data),
  activate: (storeId: string, id: string) => api.patch(`/api/stores/${storeId}/categories/${id}/activate`),
  deactivate: (storeId: string, id: string) => api.patch(`/api/stores/${storeId}/categories/${id}/deactivate`),
  reorder: (storeId: string, data: { categoryIds: string[] }) => api.put(`/api/stores/${storeId}/categories/reorder`, data),
};

// ========== Product API ==========
export const productApi = {
  list: (storeId: string, params?: any) => api.get(`/api/stores/${storeId}/products`, { params }),
  get: (storeId: string, id: string) => api.get(`/api/stores/${storeId}/products/${id}`),
  create: (storeId: string, data: any) => api.post(`/api/stores/${storeId}/products`, data),
  update: (storeId: string, id: string, data: any) => api.put(`/api/stores/${storeId}/products/${id}`, data),
  deactivate: (storeId: string, id: string) => api.patch(`/api/stores/${storeId}/products/${id}/deactivate`),
  activate: (storeId: string, id: string) => api.patch(`/api/stores/${storeId}/products/${id}/activate`),
  duplicate: (storeId: string, id: string) => api.post(`/api/stores/${storeId}/products/${id}/duplicate`),
  uploadImage: (storeId: string, productId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/api/stores/${storeId}/products/${productId}/images`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  deleteImage: (storeId: string, productId: string, imageId: string) =>
    api.delete(`/api/stores/${storeId}/products/${productId}/images/${imageId}`),
};

// ========== Inventory API ==========
export const inventoryApi = {
  list: (storeId: string, params?: any) => api.get(`/api/stores/${storeId}/inventory`, { params }),
  get: (storeId: string, variantId: string) => api.get(`/api/stores/${storeId}/inventory/${variantId}`),
  stockIn: (storeId: string, data: any) => api.post(`/api/stores/${storeId}/inventory/stock-in`, data),
  stockOut: (storeId: string, data: any) => api.post(`/api/stores/${storeId}/inventory/stock-out`, data),
  adjust: (storeId: string, data: any) => api.post(`/api/stores/${storeId}/inventory/adjust`, data),
  history: (storeId: string, params?: any) => api.get(`/api/stores/${storeId}/inventory/history`, { params }),
};

// ========== Purchase API ==========
export const purchaseApi = {
  list: (storeId: string, params?: any) => api.get(`/api/stores/${storeId}/purchases`, { params }),
  get: (storeId: string, id: string) => api.get(`/api/stores/${storeId}/purchases/${id}`),
  create: (storeId: string, data: any) => api.post(`/api/stores/${storeId}/purchases`, data),
};

// ========== Sales API ==========
export const salesApi = {
  list: (storeId: string, params?: any) => api.get(`/api/stores/${storeId}/sales`, { params }),
  get: (storeId: string, id: string) => api.get(`/api/stores/${storeId}/sales/${id}`),
  create: (storeId: string, data: any, idempotencyKey: string) =>
    api.post(`/api/stores/${storeId}/sales`, data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
};

// ========== Dashboard API ==========
export const dashboardApi = {
  metrics: (storeId: string) => api.get(`/api/stores/${storeId}/dashboard/metrics`),
};

// ========== Storefront API ==========
export const storefrontApi = {
  getStore: (slug: string) => api.get(`/api/storefront/${slug}`),
  getCategories: (slug: string) => api.get(`/api/storefront/${slug}/categories`),
  getProducts: (slug: string, params?: any) => api.get(`/api/storefront/${slug}/products`, { params }),
  placeOrder: (slug: string, data: any) => api.post(`/api/storefront/${slug}/orders`, data),
};

// ========== Orders API ==========
export const ordersApi = {
  list: (storeId: string, params?: any) => api.get(`/api/stores/${storeId}/orders`, { params }),
  get: (storeId: string, id: string) => api.get(`/api/stores/${storeId}/orders/${id}`),
  accept: (storeId: string, id: string) => api.patch(`/api/stores/${storeId}/orders/${id}/accept`),
  reject: (storeId: string, id: string, data?: { reason: string }) => api.patch(`/api/stores/${storeId}/orders/${id}/reject`, data),
  updateStatus: (storeId: string, id: string, data: { status: string }) => api.patch(`/api/stores/${storeId}/orders/${id}/status`, data),
  complete: (storeId: string, id: string) => api.patch(`/api/stores/${storeId}/orders/${id}/complete`),
  cancel: (storeId: string, id: string, data?: { reason: string }) => api.patch(`/api/stores/${storeId}/orders/${id}/cancel`, data),
};

