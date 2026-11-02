import { api } from './client';
import type { Product, Order } from './types';

/**
 * The merchant API added for the roadmap's operations, relationship and
 * automation features — backend docs/API.md. Kept beside endpoints.ts so each
 * file stays readable; screens import from here for these features.
 */

const store = (storeId: string) => `/merchant/stores/${storeId}`;

// ── Refunds ─────────────────────────────────────────────────────────────────

export type RefundStatus = 'initiated' | 'processing' | 'refunded' | 'failed';

export interface RefundEvent { fromStatus: RefundStatus | null; toStatus: RefundStatus; label: string; source: string; note: string | null; at: string }

export interface Refund {
  id: string;
  orderId: string;
  orderNumber?: string | null;
  kind: 'cancellation' | 'adjustment';
  status: RefundStatus;
  statusLabel: string;
  amountPaise: number;
  method: 'provider' | 'khata_credit' | 'cash';
  methodLabel: string;
  reference: string | null;
  reason: string | null;
  initiatedBy: string;
  failureReason: string | null;
  attempts: number;
  initiatedAt: string;
  refundedAt: string | null;
  failedAt: string | null;
  nextStep: string;
  isFinal: boolean;
  events: RefundEvent[];
}

export const refundApi = {
  list: (storeId: string, params: Record<string, unknown> = {}) => api.page<{ refunds: Refund[] }>(`${store(storeId)}/refunds`, params),
  get: (storeId: string, refundId: string) => api.get<{ refund: Refund }>(`${store(storeId)}/refunds/${refundId}`),
  retry: (storeId: string, refundId: string) => api.post<{ refund: Refund }>(`${store(storeId)}/refunds/${refundId}/retry`),
  confirmCash: (storeId: string, refundId: string, note?: string) =>
    api.post<{ refund: Refund }>(`${store(storeId)}/refunds/${refundId}/confirm-cash`, note ? { note } : {}),
};

// ── Substitutions ───────────────────────────────────────────────────────────

export interface Substitution {
  id: string;
  orderId: string;
  orderItemId: string;
  original: { name: string; variantName: string | null; quantity: number; unitPricePaise: number } | null;
  proposed: { productId: string; variantId: string; name: string; variantName: string | null; quantity: number; unitPricePaise: number; linePaise: number };
  originalLinePaise: number;
  savingPaise: number;
  merchantNote: string | null;
  customerNote: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  autoApproved: boolean;
  createdAt: string;
}

/** The order detail with the fields added on this branch. */
export type OrderDetail = Order & {
  refund: Refund | null;
  refundAdjustments: Refund[];
  substitutions: Substitution[];
  substitutionPreference: 'contact_me' | 'allow_similar' | 'no_substitutions';
  replacedItems?: Order['items'];
};

export const substitutionApi = {
  propose: (storeId: string, orderId: string, body: { orderItemId: string; variantId: string; quantity?: number; note?: string }) =>
    api.post<{ substitution: Substitution }>(`${store(storeId)}/orders/${orderId}/substitutions`, body),
  withdraw: (storeId: string, substitutionId: string) =>
    api.post<{ substitution: Substitution }>(`${store(storeId)}/substitutions/${substitutionId}/withdraw`),
};

// ── Inbox ───────────────────────────────────────────────────────────────────

export interface MerchantNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  payload: Record<string, any>;
  isRead: boolean;
  createdAt: string;
}

export const inboxApi = {
  list: (storeId: string, params: Record<string, unknown> = {}) =>
    api.page<{ notifications: MerchantNotification[]; unreadCount: number }>(`${store(storeId)}/notifications`, params),
  read: (storeId: string, id: string) => api.post<{ notification: MerchantNotification }>(`${store(storeId)}/notifications/${id}/read`),
  readAll: (storeId: string) => api.post<{ updated: number }>(`${store(storeId)}/notifications/read-all`),
};

// ── Verification ────────────────────────────────────────────────────────────

export type VerificationStatus = 'not_submitted' | 'pending' | 'verified' | 'rejected';
export type DocType = 'gst_certificate' | 'shop_photo' | 'identity_proof' | 'business_proof' | 'address_proof' | 'other';

export interface Verification {
  status: VerificationStatus;
  statusLabel: string;
  isEditable: boolean;
  details: {
    legalName: string | null;
    businessType: string | null;
    gstApplicable: boolean;
    gstin: string | null;
    ownerName: string | null;
    ownerPhone: string | null;
    ownerEmail: string | null;
    businessAddress: { line1: string; line2?: string | null; city: string; state: string; postalCode: string } | null;
  };
  documents: { id: string; docType: DocType; label: string; mimeType: string; sizeBytes: number; uploadedAt: string }[];
  requiredDocuments: { docType: DocType; label: string; provided: boolean }[];
  missing: string[];
  rejectionReason: string | null;
  reviewNote: string | null;
  events: { fromStatus: string | null; toStatus: string; label: string; actor: string; reason: string | null; at: string }[];
}

export const verificationApi = {
  get: (storeId: string) => api.get<{ verification: Verification }>(`${store(storeId)}/verification`),
  save: (storeId: string, body: Record<string, unknown>) => api.put<{ verification: Verification }>(`${store(storeId)}/verification`, body),
  upload: (storeId: string, docType: DocType, file: File) =>
    api.upload<{ verification: Verification }>(`${store(storeId)}/verification/documents/${docType}`, file),
  remove: (storeId: string, documentId: string) => api.delete<{ verification: Verification }>(`${store(storeId)}/verification/documents/${documentId}`),
  link: (storeId: string, documentId: string) => api.get<{ url: string; expiresInSeconds: number }>(`${store(storeId)}/verification/documents/${documentId}/url`),
  submit: (storeId: string) => api.post<{ verification: Verification }>(`${store(storeId)}/verification/submit`),
};

// ── Khata ───────────────────────────────────────────────────────────────────

export interface KhataAgeing { outstandingPaise: number; overduePaise: number; advancePaise: number; earliestDueDate: string | null }

export interface KhataAccount {
  id: string;
  balancePaise: number;
  creditLimitPaise: number | null;
  availableCreditPaise: number | null;
  isActive: boolean;
  customer: { id: string; name: string | null; phone: string | null; email: string | null } | null;
  notes: string | null;
  remindersEnabled: boolean;
  ageing: KhataAgeing;
}

export interface KhataEntry {
  id: string;
  type: 'debit' | 'credit';
  entryKind: 'charge' | 'payment' | 'adjustment' | 'reversal' | 'refund_credit';
  entryLabel: string;
  amountPaise: number;
  signedAmountPaise: number;
  description: string | null;
  dueDate: string | null;
  paymentMethod: string | null;
  reversesTransactionId: string | null;
  refundId: string | null;
  orderId: string | null;
  recordedBy: string;
  occurredAt: string;
}

export interface KhataDetail {
  account: KhataAccount;
  totals: { debitPaise: number; creditPaise: number; balancePaise: number };
  transactions: KhataEntry[];
  reminders: { id: string; outstandingPaise: number; overduePaise: number; sentBy: string; note: string | null; sentAt: string }[];
}

export const khataApi = {
  list: (storeId: string, params: Record<string, unknown> = {}) =>
    api.get<{ accounts: KhataAccount[]; summary: { accountCount: number; outstandingPaise: number; overduePaise: number } }>(`${store(storeId)}/khata`, params),
  open: (storeId: string, body: Record<string, unknown>) => api.post<KhataDetail>(`${store(storeId)}/khata`, body),
  get: (storeId: string, accountId: string) => api.get<KhataDetail>(`${store(storeId)}/khata/${accountId}`),
  update: (storeId: string, accountId: string, body: Record<string, unknown>) => api.patch<KhataDetail>(`${store(storeId)}/khata/${accountId}`, body),
  entry: (storeId: string, accountId: string, body: Record<string, unknown>, key: string) =>
    api.post<{ transaction: KhataEntry }>(`${store(storeId)}/khata/${accountId}/entries`, body, { 'Idempotency-Key': key }),
  reverse: (storeId: string, accountId: string, transactionId: string, reason: string) =>
    api.post<{ transaction: KhataEntry }>(`${store(storeId)}/khata/${accountId}/entries/${transactionId}/reverse`, { reason }),
  remind: (storeId: string, accountId: string, note?: string) => api.post(`${store(storeId)}/khata/${accountId}/reminders`, note ? { note } : {}),
  settings: (storeId: string, body: { khataEnabled?: boolean; khataDueDays?: number }) =>
    api.put<{ settings: { khataEnabled: boolean; khataDueDays: number } }>(`${store(storeId)}/khata-settings`, body),
  autoReminders: (storeId: string, enabled: boolean) => api.put<{ khataAutoReminders: boolean }>(`${store(storeId)}/khata-settings/auto-reminders`, { enabled }),
};

// ── Catalogue operations ────────────────────────────────────────────────────

export interface TemplateSummary { industry: string; label: string; categoryCount: number; productCount: number; defaults: Record<string, any> }
export interface Template {
  industry: string;
  label: string;
  defaults: { lowStockThreshold: number | null; taxPercent: number; trackInventory: boolean; expiryAlertDays: number };
  categories: string[];
  products: { key: string; name: string; category: string; unit: string; taxPercent: number; variants: { name: string; suggestedPricePaise: number; weightGrams: number | null }[] }[];
}
export interface TemplateReport {
  categoriesCreated: string[];
  categoriesSkipped: string[];
  productsCreated: { key: string; productId: string; name: string }[];
  productsSkipped: string[];
  failed: { key: string; name: string; message: string }[];
}
export interface StoreDefaults { lowStockThreshold: number | null; taxPercent: number; trackInventory: boolean; expiryAlertDays: number; templateApplied: string | null }

export interface ImportPreview {
  rowCount: number;
  failedRows: { line: number; productName: string; errors: { field: string; message: string }[] }[];
  products: { productName: string; action: 'create' | 'update' | 'skip'; lines: number[]; newCategory: string | null }[];
  summary: { productsToCreate: number; productsToUpdate: number; productsSkipped: number; newCategories: string[] };
}
export interface ImportResult {
  results: { line: number; status: 'created' | 'updated' | 'skipped' | 'failed'; errors?: { field: string; message: string }[] }[];
  summary: { created: number; updated: number; skipped: number; failed: number };
}
export interface BulkResult {
  action: string;
  preview: boolean;
  results: { productId: string; name?: string; status: 'ok' | 'applied' | 'failed'; before?: any; after?: any; errors?: { code: string; message: string }[] }[];
  summary: { total: number; ok: number; failed: number };
}

export const catalogueOpsApi = {
  templates: () => api.get<{ templates: TemplateSummary[] }>('/merchant/templates'),
  template: (industry: string) => api.get<{ template: Template }>(`/merchant/templates/${industry}`),
  applyTemplate: (storeId: string, body: Record<string, unknown>) => api.post<{ report: TemplateReport }>(`${store(storeId)}/templates/apply`, body),
  defaults: (storeId: string) => api.get<{ defaults: StoreDefaults }>(`${store(storeId)}/defaults`),
  saveDefaults: (storeId: string, body: Partial<StoreDefaults>) => api.put<{ defaults: StoreDefaults }>(`${store(storeId)}/defaults`, body),
  reorderCategories: (storeId: string, categoryIds: string[]) => api.put(`${store(storeId)}/categories/order`, { categoryIds }),
  deleteCategory: (storeId: string, categoryId: string, body: { moveToCategoryId?: string; uncategorise?: boolean }) =>
    api.delete<{ movedProducts: number }>(`${store(storeId)}/categories/${categoryId}`, body),
  duplicate: (storeId: string, productId: string, name?: string) =>
    api.post<{ product: Product }>(`${store(storeId)}/products/${productId}/duplicate`, name ? { name } : {}),
  lookup: (storeId: string, params: { barcode?: string; sku?: string }) => api.get<{ product: Product; variant: Product['variants'][number] }>(`${store(storeId)}/product-lookup`, params),
  exportCsv: (storeId: string) => api.download(`${store(storeId)}/catalogue/export`),
  previewImport: (storeId: string, csv: string) => api.text<ImportPreview & { mode: 'preview' }>(`${store(storeId)}/catalogue/import`, csv, { mode: 'preview' }),
  commitImport: (storeId: string, csv: string) => api.text<ImportResult & { mode: 'commit' }>(`${store(storeId)}/catalogue/import`, csv, { mode: 'commit' }),
  bulk: (storeId: string, body: Record<string, unknown>) => api.post<{ bulk: BulkResult }>(`${store(storeId)}/products/bulk`, body),
};

// ── Suppliers, purchases, batches ───────────────────────────────────────────

export interface Supplier { id: string; name: string; phone: string | null; email: string | null; gstin: string | null; address: string | null; notes: string | null; isActive: boolean }
export interface PurchaseItem { id: string; productId: string; variantId: string; productName: string; variantName: string | null; quantity: number; unitCostPaise: number; taxPaise: number; lineTotalPaise: number; batchNumber: string | null; manufacturedOn: string | null; expiresOn: string | null }
export interface Purchase {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  purchaseDate: string;
  status: 'draft' | 'confirmed' | 'cancelled';
  totals: { subtotalPaise: number; taxPaise: number; totalPaise: number };
  notes: string | null;
  confirmedAt: string | null;
  createdAt: string;
  items?: PurchaseItem[];
}
export interface Batch {
  id: string;
  productId: string;
  productName: string | null;
  variantId: string;
  variantName: string | null;
  sku: string | null;
  batchNumber: string | null;
  manufacturedOn: string | null;
  expiresOn: string | null;
  daysToExpiry: number | null;
  expiryState: 'ok' | 'expiring' | 'expired' | 'no_expiry';
  quantityReceived: number;
  quantityRemaining: number;
  unitCostPaise: number | null;
  receivedAt: string;
}

export const purchaseApi = {
  suppliers: (storeId: string, includeInactive = false) => api.get<{ suppliers: Supplier[] }>(`${store(storeId)}/suppliers`, includeInactive ? { includeInactive: 'true' } : {}),
  createSupplier: (storeId: string, body: Record<string, unknown>) => api.post<{ supplier: Supplier }>(`${store(storeId)}/suppliers`, body),
  updateSupplier: (storeId: string, id: string, body: Record<string, unknown>) => api.patch<{ supplier: Supplier }>(`${store(storeId)}/suppliers/${id}`, body),
  list: (storeId: string, params: Record<string, unknown> = {}) => api.page<{ purchases: Purchase[] }>(`${store(storeId)}/purchases`, params),
  get: (storeId: string, id: string) => api.get<{ purchase: Purchase }>(`${store(storeId)}/purchases/${id}`),
  create: (storeId: string, body: Record<string, unknown>) => api.post<{ purchase: Purchase }>(`${store(storeId)}/purchases`, body),
  update: (storeId: string, id: string, body: Record<string, unknown>) => api.put<{ purchase: Purchase }>(`${store(storeId)}/purchases/${id}`, body),
  confirm: (storeId: string, id: string) => api.post<{ purchase: Purchase }>(`${store(storeId)}/purchases/${id}/confirm`),
  cancel: (storeId: string, id: string) => api.post<{ purchase: Purchase }>(`${store(storeId)}/purchases/${id}/cancel`),
  batches: (storeId: string, params: Record<string, unknown> = {}) =>
    api.page<{ batches: Batch[]; summary: { expiringCount: number; expiredCount: number; expiredQuantity: number } }>(`${store(storeId)}/inventory/batches`, params),
};

// ── Customers (CRM), loyalty, coupons, offers ───────────────────────────────

export type Segment = 'prospect' | 'new' | 'active' | 'loyal' | 'inactive';
export interface CrmCustomer {
  customerId: string;
  name: string | null;
  phone: string | null;
  segment: Segment;
  segmentLabel: string;
  orderCount: number;
  totalSpendPaise: number;
  averageOrderPaise: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  medianDaysBetweenOrders: number | null;
  openOrders: number;
  isFollower: boolean;
  consent: { promotions: boolean; reminders: boolean; sms: boolean; whatsapp: boolean; email: boolean };
  khataBalancePaise: number | null;
  loyaltyPoints: number | null;
  tags: string[];
}
export interface CrmCustomerDetail extends CrmCustomer {
  notes: string | null;
  favouriteProducts: { repeatPurchases: { productId: string; name: string; orderCount: number; units: number }[]; saved: { productId: string; name: string | null }[] };
  khata: { accountId: string; balancePaise: number; creditLimitPaise: number | null } | null;
  purchaseHistory: { id: string; orderNumber: string; status: string; statusLabel: string; totalPaise: number; placedAt: string; completedAt: string | null }[];
}
export interface LedgerItem { id: string; kind: string; label: string; points: number; pointsAfter: number; note: string | null; at: string }
export interface LoyaltyProgram {
  isActive: boolean; earnPointsPer100: number; pointValuePaise: number; minOrderPaiseToEarn: number; minRedeemPoints: number;
  maxRedeemPercent: number; welcomeBonusPoints: number; pointsExpireDays: number | null; summary: string;
}
export interface Reward { id: string; name: string; description: string | null; pointsCost: number; discountType: 'flat' | 'percent' | 'free_delivery'; percentOff: number | null; amountOffPaise: number | null; isActive: boolean }
export interface Coupon {
  id: string; code: string; title: string; description: string | null; discountType: 'percent' | 'flat' | 'free_delivery';
  percentOff: number | null; amountOffPaise: number | null; maxDiscountPaise: number | null; minOrderPaise: number;
  startsAt: string; endsAt: string | null; audience: string; stackableWithLoyalty: boolean; isActive: boolean;
  maxUses: number | null; maxUsesPerCustomer: number; timesUsed: number; totalDiscountPaise: number;
}
export interface Offer {
  id: string; kind: 'expiry' | 'promotion'; title: string; description: string | null; productId: string; productName: string | null;
  variantId: string; variantName: string | null; listPricePaise: number | null; offerPricePaise: number; savingPaise: number | null;
  startsAt: string; endsAt: string; quantityLimit: number | null; quantitySold: number; unitsLeft: number | null;
  batchExpiresOn: string | null; expiryCutoffDays: number; radiusKm: number; isLive: boolean; status: 'live' | 'scheduled' | 'ended';
  endReason: string | null; endReasonLabel: string | null;
}

export const crmApi = {
  list: (storeId: string, params: Record<string, unknown> = {}) =>
    api.page<{ customers: CrmCustomer[]; segments: Record<Segment, number>; rules: Record<string, number> }>(`${store(storeId)}/customers`, params),
  get: (storeId: string, customerId: string) => api.get<{ customer: CrmCustomerDetail }>(`${store(storeId)}/customers/${customerId}`),
  saveNotes: (storeId: string, customerId: string, body: { notes?: string | null; tags?: string[] }) =>
    api.patch<{ customer: CrmCustomerDetail }>(`${store(storeId)}/customers/${customerId}`, body),
  points: (storeId: string, customerId: string) => api.get<{ history: LedgerItem[] }>(`${store(storeId)}/customers/${customerId}/points`),
  adjustPoints: (storeId: string, customerId: string, body: { points: number; reason: string }) =>
    api.post<{ balance: number; history: LedgerItem[] }>(`${store(storeId)}/customers/${customerId}/points`, body),
};

export const loyaltyApi = {
  program: (storeId: string) => api.get<{ program: LoyaltyProgram | null }>(`${store(storeId)}/loyalty`),
  saveProgram: (storeId: string, body: Partial<LoyaltyProgram>) => api.put<{ program: LoyaltyProgram }>(`${store(storeId)}/loyalty`, body),
  rewards: (storeId: string) => api.get<{ rewards: Reward[] }>(`${store(storeId)}/loyalty/rewards`),
  createReward: (storeId: string, body: Record<string, unknown>) => api.post<{ reward: Reward }>(`${store(storeId)}/loyalty/rewards`, body),
  updateReward: (storeId: string, id: string, body: Record<string, unknown>) => api.patch<{ reward: Reward }>(`${store(storeId)}/loyalty/rewards/${id}`, body),
  members: (storeId: string, params: Record<string, unknown> = {}) =>
    api.page<{ members: { customerId: string; name: string | null; points: number; lifetimeEarned: number; lifetimeRedeemed: number }[] }>(`${store(storeId)}/loyalty/members`, params),
};

export const couponApi = {
  list: (storeId: string) => api.get<{ coupons: Coupon[] }>(`${store(storeId)}/coupons`),
  create: (storeId: string, body: Record<string, unknown>) => api.post<{ coupon: Coupon }>(`${store(storeId)}/coupons`, body),
  update: (storeId: string, id: string, body: Record<string, unknown>) => api.patch<{ coupon: Coupon }>(`${store(storeId)}/coupons/${id}`, body),
};

export const offerApi = {
  list: (storeId: string, status = 'all') => api.get<{ offers: Offer[] }>(`${store(storeId)}/offers`, { status }),
  create: (storeId: string, body: Record<string, unknown>) => api.post<{ offer: Offer }>(`${store(storeId)}/offers`, body),
  end: (storeId: string, id: string) => api.post<{ offer: Offer }>(`${store(storeId)}/offers/${id}/end`),
};

// ── Conversations and announcements ─────────────────────────────────────────

export interface Conversation {
  id: string; kind: 'question' | 'special_request' | 'order' | 'support'; kindLabel: string; requestType: string | null; subject: string;
  status: 'awaiting_store' | 'awaiting_customer' | 'resolved' | 'escalated'; statusLabel: string;
  customer?: { id: string; name: string | null }; order: { id: string; orderNumber: string | null } | null;
  product: { id: string; name: string | null } | null; lastMessageAt: string; isUnread: boolean; createdAt: string;
  messages?: { id: string; from: 'customer' | 'merchant' | 'admin' | 'system'; body: string; at: string }[];
}

export const messagingApi = {
  list: (storeId: string, params: Record<string, unknown> = {}) => api.get<{ conversations: Conversation[] }>(`${store(storeId)}/conversations`, params),
  get: (storeId: string, id: string) => api.get<{ conversation: Conversation }>(`${store(storeId)}/conversations/${id}`),
  reply: (storeId: string, id: string, body: string, resolve = false) =>
    api.post<{ conversation: Conversation }>(`${store(storeId)}/conversations/${id}/messages`, { body, resolve }),
  announcements: (storeId: string) =>
    api.get<{ announcements: { id: string; title: string; body: string | null; recipientCount: number; sentAt: string }[]; audience: { followers: number; optedIn: number } }>(`${store(storeId)}/announcements`),
  announce: (storeId: string, body: { title: string; body?: string }) => api.post(`${store(storeId)}/announcements`, body),
};

// ── Analytics and automation ────────────────────────────────────────────────

export interface Analytics {
  period: { from: string; to: string; days: number; timezone: string };
  sales: {
    grossSalesPaise: number; ordersRevenuePaise: number; counterSalesPaise: number; completedOrders: number; counterSales: number;
    averageTicketPaise: number; refundsPaise: number;
    trend: { date: string; ordersPaise: number; posPaise: number; orders: number; sales: number; refundsPaise: number }[];
  };
  orders: { placed: number; byStatus: Record<string, number>; cancellationRate: number; medianMinutesToAccept: number | null; byFulfilment: { pickup: number; delivery: number } };
  products: {
    bestSellers: { productId: string; name: string; units: number; revenuePaise: number }[];
    slowMovers: { productId: string; name: string; unitsSold: number; onHand: number }[];
    unavailable: { productId: string; name: string; reason: string; unitsSoldInPeriod: number }[];
  };
  customers: { segments: Record<string, number>; buyersInPeriod: number; newInPeriod: number; returningInPeriod: number };
  khata: { outstandingPaise: number; overduePaise: number; collectedPaise: number; chargedPaise: number; accountsOverdue: number };
  definitions: Record<string, string>;
}
export interface Suggestion {
  productId: string; productName: string; variantId: string; variantName: string | null; sku: string | null; available: number;
  onDraftPurchases: number; soldLastPeriod: number; dailyRate: number; suggestedQuantity: number; lastCostPaise: number | null;
  estimatedCostPaise: number | null; reason: string;
}
export interface Task {
  id: string; title: string; taskType: string; frequency: 'daily' | 'weekly' | 'monthly'; dayOfWeek: number | null;
  dayOfMonth: number | null; timeOfDay: string; isActive: boolean; nextRunAt: string; lastRunAt: string | null;
}

export const automationApi = {
  analytics: (storeId: string, params: { from?: string; to?: string } = {}) => api.get<{ analytics: Analytics }>(`${store(storeId)}/analytics`, params),
  lowStock: (storeId: string) =>
    api.get<{ items: { productId: string; productName: string; variantId: string; variantName: string | null; sku: string | null; availableQuantity: number; lowStockThreshold: number }[] }>(`${store(storeId)}/low-stock`),
  suggestions: (storeId: string, params: { coverDays?: number; lookbackDays?: number } = {}) =>
    api.get<{ suggestions: { coverDays: number; lookbackDays: number; suggestions: Suggestion[] } }>(`${store(storeId)}/purchase-suggestions`, params),
  draftFromSuggestions: (storeId: string, body: { supplierId?: string; items: { variantId: string; quantity: number; unitCostPaise: number }[] }) =>
    api.post<{ purchase: Purchase }>(`${store(storeId)}/purchase-suggestions/draft`, body),
  tasks: (storeId: string) => api.get<{ tasks: Task[] }>(`${store(storeId)}/tasks`),
  createTask: (storeId: string, body: Record<string, unknown>) => api.post<{ task: Task }>(`${store(storeId)}/tasks`, body),
  updateTask: (storeId: string, id: string, body: Record<string, unknown>) => api.patch<{ task: Task }>(`${store(storeId)}/tasks/${id}`, body),
  deleteTask: (storeId: string, id: string) => api.delete(`${store(storeId)}/tasks/${id}`, {}),
};

// ── Intelligence (Phase D/E): read-only, every change is confirmed ──────────

export interface StockItem {
  productId: string; variantId: string; name: string; available: number | null; soldLast30: number;
  forecast: { confidence: 'insufficient' | 'low' | 'medium' | 'high'; reason: string; dailyAverage: number | null; nextDaysUnits: number | null; horizonDays: number };
  health: { status: 'stockout' | 'at_risk' | 'overstock' | 'slow' | 'healthy' | 'unknown' | 'untracked'; daysOfCover: number | null; note: string };
  proposedReorderQuantity: number | null;
}
export interface Proposal { summary: string; apply: { method: 'POST' | 'PATCH'; path: string; body: Record<string, unknown> }; requiresConfirmation: true; warning?: string }
export interface CommandResult { understood: boolean; proposal: Proposal | null; problem?: string | null; options?: { variantId?: string; productId?: string; name: string }[]; help?: string[] }
export interface AssistantReply {
  kind: 'answer' | 'proposal' | 'help'; intent?: string; answer?: string; source?: string; examples?: string[];
  actions?: { type: string; text: string; to: string }[]; proposal?: Proposal | null; problem?: string | null; options?: CommandResult['options']; understood?: boolean;
}
export interface InvoiceRead {
  supplier: { name: string; source: 'label' | 'first_line'; match: { supplierId: string; name: string } | null } | null;
  invoiceNumber: string | null; invoiceDate: string | null; statedTotalPaise: number | null; computedTotalPaise: number; totalMatches: boolean | null;
  warnings: string[];
  lines: { source: string; readAs: { name: string; quantity: number; unitCostPaise: number; batchNumber: string | null; expiresOn: string | null }; match: { productId: string; variantId: string; name: string; lastCostPaise: number | null } | null; confidence: 'none' | 'low' | 'medium' | 'high'; warnings: string[]; alternatives: { variantId: string; name: string }[] }[];
  skipped: string[];
}
export interface ProductSuggestion {
  suggestions: {
    category: { id: string | null; name: string; reason: string } | null; unit: { value: string; reason: string } | null;
    taxPercent: { value: number; reason: string } | null; weightGrams: { value: number; reason: string } | null;
    variants: { name: string; suggestedPricePaise: number; weightGrams: number | null }[];
  };
  duplicates: { productId: string; name: string }[]; related: { productId: string; name: string }[]; nextActions: { type: string; text: string }[];
}
export interface ProductRecognition {
  read: { isProduct: boolean; name: string | null; brand: string | null; sizeText: string | null; category: string | null; barcode: string | null; mrpPaise: number | null; weightGrams: number | null; confidence: number };
  identified: boolean;
  match: { productId: string; variantId: string | null; name: string; by: 'barcode' | 'name'; score: number; isAvailable: boolean; pricePaise: number | null } | null;
  candidates: { productId: string; variantId: string | null; name: string; score: number; isAvailable: boolean; pricePaise: number | null }[];
  suggestion: {
    name: string; category: ProductSuggestion['suggestions']['category']; unit: ProductSuggestion['suggestions']['unit'];
    taxPercent: ProductSuggestion['suggestions']['taxPercent']; weightGrams: number | null; mrpPaise: number | null; barcode: string | null;
    duplicates: ProductSuggestion['duplicates'];
  } | null;
  note: string;
}
export interface AreaInsights {
  city: string | null; minStores: number; otherStores?: number; note: string;
  benchmarks: { productId: string; variantId: string; name: string; basis: 'per_kg' | 'per_pack'; yourPricePaise: number; area: { stores: number; p25: number; median: number; p75: number }; position: 'below_most' | 'typical' | 'above_most' }[];
  popularNearby: { name: string; shops: string }[];
}
export interface Alternative { product: { id: string; name: string; pricePaise: number; isPurchasable: boolean }; reason: string; score: number }

export const intelligenceApi = {
  stock: (storeId: string, params: { horizonDays?: number; leadDays?: number } = {}) =>
    api.get<{ stock: { today: string; horizonDays: number; leadDays: number; counts: Record<string, number>; items: StockItem[]; method: string } }>(`${store(storeId)}/intelligence/stock`, params),
  suggest: (storeId: string, name: string) => api.post<{ suggestion: ProductSuggestion }>(`${store(storeId)}/intelligence/product-suggestions`, { name }),
  invoice: (storeId: string, text: string) => api.post<{ invoice: InvoiceRead }>(`${store(storeId)}/intelligence/invoice`, { text }),
  /** A photo or PDF of a supplier bill, read by the vision model into the same shape as pasted text. */
  invoiceFile: (storeId: string, file: File) => api.upload<{ invoice: InvoiceRead & { source: 'file'; transcript: string[] } }>(`${store(storeId)}/intelligence/invoice-file`, file),
  /** A photo of a product: matched to this shop's catalogue, or a prefill for a new one. */
  recognize: (storeId: string, file: File) => api.upload<{ recognition: ProductRecognition }>(`${store(storeId)}/intelligence/recognize`, file),
  command: (storeId: string, text: string) => api.post<{ command: CommandResult }>(`${store(storeId)}/intelligence/command`, { text }),
  ask: (storeId: string, question: string) => api.post<{ reply: AssistantReply }>(`${store(storeId)}/intelligence/ask`, { question }),
  area: (storeId: string) => api.get<{ area: AreaInsights }>(`${store(storeId)}/intelligence/area`),
  alternatives: (storeId: string, productId: string) => api.get<{ alternatives: { productId: string; items: Alternative[] } }>(`${store(storeId)}/products/${productId}/alternatives`),
  /**
   * Applies a confirmed proposal through the endpoint it names. Only the
   * caller's own store, and only the methods proposals use.
   */
  apply: (storeId: string, proposal: Proposal) => {
    const prefix = `${store(storeId)}/`;
    if (!proposal.apply.path.startsWith(prefix)) throw new Error('That proposal is for another store.');
    return proposal.apply.method === 'PATCH' ? api.patch(proposal.apply.path, proposal.apply.body) : api.post(proposal.apply.path, proposal.apply.body);
  },
};
