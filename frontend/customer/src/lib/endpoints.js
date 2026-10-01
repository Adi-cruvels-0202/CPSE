/**
 * Every backend call the app makes, named, in one file.
 *
 * Screens call `endpoints.cart.addItem(...)`, never `api.post('/cart/items')`.
 * That keeps the URL map in one place — the mirror of the backend's own
 * `routes.js` — so a contract change is found here instead of in nine
 * components, and a reader can see the whole API surface at a glance.
 *
 * The `auth` mode on each call is the interesting part, and it matches
 * backend/docs/API.md:
 *
 *   none      credentials and the password-reset pair
 *   optional  public store pages — they must open from a shared link with no
 *             session, and personalise when there is one
 *   required  everything a customer owns
 */
import { api, request } from './api.js';

export const endpoints = {
  health: () => request('/health', { auth: 'none' }),

  auth: {
    register: (body) => api.post('/auth/register', body, { auth: 'none' }),
    login: (body) => api.post('/auth/login', body, { auth: 'none' }),
    logout: () => api.post('/auth/logout', undefined),
    forgotPassword: (body) => api.post('/auth/forgot-password', body, { auth: 'none' }),
    resetPassword: (body) => api.post('/auth/reset-password', body, { auth: 'none' }),
  },

  profile: {
    get: () => api.get('/me'),
    update: (body) => api.patch('/me', body),
  },

  stores: {
    get: (slug) => api.get(`/stores/${slug}`, { auth: 'optional' }),
    categories: (slug) => api.get(`/stores/${slug}/categories`, { auth: 'optional' }),
    products: (slug, query) => api.get(`/stores/${slug}/products`, { auth: 'optional', query }),
    product: (slug, productId) =>
      api.get(`/stores/${slug}/products/${productId}`, { auth: 'optional' }),
    search: (slug, query) => api.get(`/stores/${slug}/search`, { auth: 'optional', query }),
    save: (storeId) => api.post(`/stores/${storeId}/save`, undefined),
    unsave: (storeId) => api.delete(`/stores/${storeId}/save`),
  },

  savedStores: {
    list: (query) => api.get('/saved-stores', { query }),
  },

  cart: {
    get: (storeId) => api.get('/cart', { query: { storeId } }),
    addItem: (body) => api.post('/cart/items', body),
    updateItem: (itemId, body) => api.patch(`/cart/items/${itemId}`, body),
    removeItem: (itemId) => api.delete(`/cart/items/${itemId}`),
    clear: (storeId) => api.delete('/cart', { query: { storeId } }),
    validate: (body) => api.post('/cart/validate', body),
  },

  addresses: {
    list: () => api.get('/addresses'),
    create: (body) => api.post('/addresses', body),
    get: (id) => api.get(`/addresses/${id}`),
    update: (id, body) => api.patch(`/addresses/${id}`, body),
    remove: (id) => api.delete(`/addresses/${id}`),
    setDefault: (id) => api.post(`/addresses/${id}/default`, undefined),
  },

  checkout: {
    quote: (body) => api.post('/checkout/quote', body),
  },

  orders: {
    // The idempotency key is the caller's to supply — it must survive a retry,
    // so it is generated when the customer opens the review screen, not here.
    create: (body, idempotencyKey) => api.post('/orders', body, { idempotencyKey }),
    list: (query) => api.get('/orders', { query }),
    get: (id) => api.get(`/orders/${id}`),
    cancel: (id, body) => api.post(`/orders/${id}/cancel`, body ?? {}),
    receipt: (id) => api.get(`/orders/${id}/receipt`),
    reorder: (id) => api.post(`/orders/${id}/reorder`, undefined),
  },

  payments: {
    methods: () => api.get('/payments/methods', { auth: 'optional' }),
    initiate: (orderId) => api.post(`/payments/${orderId}/initiate`, undefined),
    verify: (orderId, body) => api.post(`/payments/${orderId}/verify`, body ?? {}),
  },

  notifications: {
    list: (query) => api.get('/notifications', { query }),
    unreadCount: () => api.get('/notifications/unread-count'),
    markRead: (id) => api.post(`/notifications/${id}/read`, undefined),
    markAllRead: () => api.post('/notifications/read-all', undefined),
  },

  khata: {
    list: () => api.get('/khata'),
    get: (accountId, query) => api.get(`/khata/${accountId}`, { query }),
    statement: (accountId, query) => api.get(`/khata/${accountId}/statement`, { query }),
  },
};
