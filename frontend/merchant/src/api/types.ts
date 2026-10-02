/**
 * The shapes the merchant API answers with — backend docs/API.md, Merchant
 * sections. Money is always integer paise.
 */

export interface Merchant {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  createdAt: string;
}

export interface StoreSummary {
  id: string;
  name: string;
  slug: string;
  isPublished: boolean;
  logoUrl: string | null;
}

export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export interface OpeningWindow {
  open: string;
  close: string;
}
export type OpeningHours = Partial<Record<Day, OpeningWindow[]>>;

export interface StoreAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
}

export interface Store {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  shopCategory: string | null;
  phone: string | null;
  email: string | null;
  address: StoreAddress | null;
  latitude: number | null;
  longitude: number | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  timezone: string;
  openingHours: OpeningHours;
  hours: { isOpen: boolean; opensAt: string | null };
  fulfilment: {
    pickupEnabled: boolean;
    deliveryEnabled: boolean;
    deliveryFeePaise: number;
    minOrderPaise: number;
    freeDeliveryThresholdPaise: number | null;
    deliveryRadiusKm: number | null;
  };
  paymentMethods: { cash: boolean; online: boolean };
  isPublished: boolean;
  publicPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface Holiday {
  id: string;
  date: string;
  reason: string | null;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  productCount: number;
}

export interface Variant {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  weightGrams: number | null;
  pricePaise: number;
  mrpPaise: number | null;
  costPaise: number | null;
  isActive: boolean;
  sortOrder: number;
  quantityOnHand: number | null;
  reservedQuantity: number | null;
  availableQuantity: number | null;
  isLowStock: boolean;
}

export interface ProductImage {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  unit: string;
  taxPercent: number;
  trackInventory: boolean;
  lowStockThreshold: number | null;
  isActive: boolean;
  pricePaise: number;
  images: ProductImage[];
  variants: Variant[];
  stock: { quantityOnHand: number; reservedQuantity: number; availableQuantity: number } | null;
  isLowStock: boolean;
}

export interface StockVariant {
  id: string;
  productId: string;
  productName: string;
  name: string;
  sku: string | null;
  quantityOnHand: number;
  reservedQuantity: number;
  availableQuantity: number;
  isLowStock: boolean;
}

export interface LedgerEntry {
  id: string;
  movementType: string;
  productId: string;
  productName: string | null;
  variantId: string;
  variantName: string | null;
  sku: string | null;
  onHandChange: number;
  reservedChange: number;
  onHandAfter: number;
  reservedAfter: number;
  availableAfter: number;
  unitCostPaise: number | null;
  reason: string | null;
  notes: string | null;
  reference: { type: string; id: string; number: string | null } | null;
  performedBy: { type: string; id: string | null };
  createdAt: string;
}

export interface Totals {
  subtotalPaise: number;
  discountPaise: number;
  deliveryFeePaise?: number;
  taxPaise: number;
  totalPaise: number;
}

export interface LineItem {
  id: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string | null;
  quantity: number;
  unitPricePaise: number;
  lineSubtotalPaise: number;
  taxPercent: number;
  taxPaise: number;
  lineTotalPaise: number;
}

export type OrderStatus =
  | 'pending_payment' | 'placed' | 'accepted' | 'preparing'
  | 'ready_for_pickup' | 'out_for_delivery' | 'completed' | 'cancelled' | 'rejected';

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  statusLabel: string;
  paymentStatus: string;
  paymentMethod: 'cash' | 'online';
  fulfilmentMode: 'pickup' | 'delivery';
  allowedActions: string[];
  customer: { id: string; name: string | null; phone: string | null };
  customerNote: string | null;
  cancellationReason: string | null;
  totals: Totals;
  itemCount: number;
  placedAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  deliveryAddress?: Record<string, string | null> | null;
  items?: LineItem[];
  history?: { status: OrderStatus; changedBy: string; note: string | null; at: string }[];
}

export interface Sale {
  id: string;
  invoiceNumber: string;
  paymentMethod: 'cash' | 'upi' | 'card' | 'other';
  customerName: string | null;
  customerPhone: string | null;
  notes: string | null;
  totals: Totals;
  itemCount: number;
  items?: LineItem[];
  createdAt: string;
}

export interface Dashboard {
  date: string;
  today: { ordersCount: number; ordersRevenuePaise: number; salesCount: number; salesRevenuePaise: number };
  openOrders: { placed: number; accepted: number; preparing: number; ready: number };
  lowStock: {
    productId: string;
    productName: string;
    variantId: string;
    variantName: string;
    sku: string | null;
    availableQuantity: number;
    lowStockThreshold: number;
  }[];
  recentOrders: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    statusLabel: string;
    fulfilmentMode: string;
    totalPaise: number;
    placedAt: string;
  }[];
}
