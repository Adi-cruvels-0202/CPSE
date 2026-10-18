import { supabaseAdmin } from '../../lib/supabase.js';
import { conflict, internal, notFound, unprocessable } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

/**
 * Suppliers and purchases — roadmap §4 P1 "Purchase management", "Batch &
 * expiry", "Inventory ledger": every stock purchase has a traceable source.
 *
 * A purchase is drafted (lines can change) and then confirmed. Confirming is
 * one SQL transaction (confirm_purchase, migration 0040): each line goes on the
 * shelf as a 'purchase' ledger movement that references the purchase and
 * carries its unit cost, and opens a batch when it has a batch number or an
 * expiry. A confirmed purchase is never edited; a return to the supplier is a
 * stock-out with that reason.
 */

const SUPPLIER_COLUMNS = 'id, store_id, name, phone, email, gstin, address, notes, is_active, created_at, updated_at';
const PURCHASE_COLUMNS = `
  id, store_id, supplier_id, supplier_name, invoice_number, invoice_date, purchase_date, status,
  subtotal_paise, tax_paise, total_paise, notes, created_by, confirmed_by, confirmed_at, created_at, updated_at
`;
const ITEM_COLUMNS = `
  id, purchase_id, product_id, variant_id, product_name, variant_name, quantity, unit_cost_paise,
  tax_paise, line_total_paise, batch_number, manufactured_on, expires_on
`;

const fail = (error, message) => {
  if (error) throw internal(message);
};

// ── Suppliers ───────────────────────────────────────────────────────────────

export const toSupplier = (row) => ({
  id: row.id,
  name: row.name,
  phone: row.phone ?? null,
  email: row.email ?? null,
  gstin: row.gstin ?? null,
  address: row.address ?? null,
  notes: row.notes ?? null,
  isActive: row.is_active,
  createdAt: row.created_at,
});

export async function listSuppliers(store, { includeInactive = false } = {}) {
  let query = supabaseAdmin.from('suppliers').select(SUPPLIER_COLUMNS).eq('store_id', store.id);
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query.order('name', { ascending: true });
  fail(error, 'Could not load the suppliers.');
  return (data ?? []).map(toSupplier);
}

const supplierRow = (input) => {
  const row = {};
  for (const [key, column] of [
    ['name', 'name'], ['phone', 'phone'], ['email', 'email'], ['gstin', 'gstin'],
    ['address', 'address'], ['notes', 'notes'], ['isActive', 'is_active'],
  ]) {
    if (input[key] !== undefined) row[column] = input[key];
  }
  return row;
};

export async function createSupplier(store, input) {
  const { data, error } = await supabaseAdmin
    .from('suppliers')
    .insert({ store_id: store.id, ...supplierRow(input) })
    .select(SUPPLIER_COLUMNS)
    .maybeSingle();
  if (error?.code === '23505') throw conflict(`You already have a supplier called "${input.name}".`);
  fail(error, 'Could not save the supplier.');
  return toSupplier(data);
}

export async function updateSupplier(store, supplierId, input) {
  const { data, error } = await supabaseAdmin
    .from('suppliers')
    .update(supplierRow(input))
    .eq('id', supplierId)
    .eq('store_id', store.id)
    .select(SUPPLIER_COLUMNS)
    .maybeSingle();
  if (error?.code === '23505') throw conflict(`You already have a supplier called "${input.name}".`);
  fail(error, 'Could not save the supplier.');
  if (!data) throw notFound('Supplier');
  return toSupplier(data);
}

// ── Purchases ───────────────────────────────────────────────────────────────

const toItem = (row) => ({
  id: row.id,
  productId: row.product_id,
  variantId: row.variant_id,
  productName: row.product_name,
  variantName: row.variant_name ?? null,
  quantity: row.quantity,
  unitCostPaise: row.unit_cost_paise,
  taxPaise: row.tax_paise,
  lineTotalPaise: row.line_total_paise,
  batchNumber: row.batch_number ?? null,
  manufacturedOn: row.manufactured_on ?? null,
  expiresOn: row.expires_on ?? null,
});

function toPurchase(row, items = null) {
  return {
    id: row.id,
    supplierId: row.supplier_id ?? null,
    supplierName: row.supplier_name ?? null,
    invoiceNumber: row.invoice_number ?? null,
    invoiceDate: row.invoice_date ?? null,
    purchaseDate: row.purchase_date,
    status: row.status,
    totals: { subtotalPaise: row.subtotal_paise, taxPaise: row.tax_paise, totalPaise: row.total_paise },
    notes: row.notes ?? null,
    confirmedAt: row.confirmed_at ?? null,
    createdAt: row.created_at,
    ...(items ? { items: items.map(toItem), itemCount: items.length } : {}),
  };
}

async function findPurchase(store, purchaseId) {
  const { data, error } = await supabaseAdmin
    .from('purchases')
    .select(PURCHASE_COLUMNS)
    .eq('id', purchaseId)
    .eq('store_id', store.id)
    .maybeSingle();
  fail(error, 'Could not load the purchase.');
  if (!data) throw notFound('Purchase');
  return data;
}

export async function getPurchase(store, purchaseId) {
  const row = await findPurchase(store, purchaseId);
  const { data, error } = await supabaseAdmin
    .from('purchase_items')
    .select(ITEM_COLUMNS)
    .eq('purchase_id', row.id)
    .order('created_at', { ascending: true });
  fail(error, 'Could not load the purchase lines.');
  return toPurchase(row, data ?? []);
}

export async function listPurchases(store, { status, supplierId, page = 1, limit = 20 }) {
  let query = supabaseAdmin.from('purchases').select(PURCHASE_COLUMNS, { count: 'exact' }).eq('store_id', store.id);
  if (status) query = query.eq('status', status);
  if (supplierId) query = query.eq('supplier_id', supplierId);
  const from = (page - 1) * limit;
  const { data, count, error } = await query
    .order('purchase_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);
  fail(error, 'Could not load the purchases.');
  return { purchases: (data ?? []).map((row) => toPurchase(row)), total: count ?? 0 };
}

const SAVE_ERRORS = {
  PURCHASE_NOT_FOUND: () => notFound('Purchase'),
  SUPPLIER_NOT_FOUND: () => notFound('Supplier'),
  VARIANT_NOT_FOUND: () => notFound('Product variant'),
  PURCHASE_NOT_DRAFT: () => conflict('Only a draft purchase can be changed.'),
  PURCHASE_CANCELLED: () => conflict('This purchase was cancelled.'),
  PURCHASE_EMPTY: () => unprocessable('PURCHASE_EMPTY', 'Add at least one item before confirming.'),
};

function translate(error, fallback) {
  const message = error?.message ?? '';
  if (error?.code === '23505' && message.includes('purchases_supplier_invoice_key')) {
    return conflict('A purchase with this invoice number from this supplier is already recorded.');
  }
  if (message.includes('NOT_TRACKED:')) {
    const name = message.split('NOT_TRACKED:')[1]?.split('\n')[0]?.trim();
    return unprocessable('NOT_TRACKED', `Stock is not counted for ${name}. Turn stock tracking on first.`);
  }
  const code = Object.keys(SAVE_ERRORS).find((name) => message.includes(name));
  if (code) return SAVE_ERRORS[code]();
  logger.error(fallback, { code: error?.code, message });
  return internal(fallback);
}

const toPayload = (store, merchant, input, purchaseId = null) => ({
  store_id: store.id,
  purchase_id: purchaseId,
  merchant_id: merchant.id,
  supplier_id: input.supplierId ?? null,
  supplier_name: input.supplierName ?? null,
  invoice_number: input.invoiceNumber ?? null,
  invoice_date: input.invoiceDate ?? null,
  purchase_date: input.purchaseDate ?? null,
  notes: input.notes ?? null,
  items: input.items.map((item) => ({
    variant_id: item.variantId,
    quantity: item.quantity,
    unit_cost_paise: item.unitCostPaise,
    tax_paise: item.taxPaise ?? 0,
    batch_number: item.batchNumber ?? null,
    manufactured_on: item.manufacturedOn ?? null,
    expires_on: item.expiresOn ?? null,
  })),
});

async function confirm(store, merchant, purchaseId) {
  const { error } = await supabaseAdmin.rpc('confirm_purchase', {
    p_store_id: store.id,
    p_purchase_id: purchaseId,
    p_merchant_id: merchant.id,
  });
  if (error) throw translate(error, 'Could not confirm the purchase.');
}

/** A new purchase; with `confirm: true` it goes on the shelf in the same request. */
export async function createPurchase(store, merchant, input) {
  const { data, error } = await supabaseAdmin.rpc('save_purchase', { payload: toPayload(store, merchant, input) });
  if (error) throw translate(error, 'Could not save the purchase.');
  const purchaseId = Array.isArray(data) ? data[0] : data;
  if (input.confirm) await confirm(store, merchant, purchaseId);
  return getPurchase(store, purchaseId);
}

export async function updatePurchase(store, merchant, purchaseId, input) {
  await findPurchase(store, purchaseId);
  const { error } = await supabaseAdmin.rpc('save_purchase', { payload: toPayload(store, merchant, input, purchaseId) });
  if (error) throw translate(error, 'Could not save the purchase.');
  if (input.confirm) await confirm(store, merchant, purchaseId);
  return getPurchase(store, purchaseId);
}

export async function confirmPurchase(store, merchant, purchaseId) {
  await findPurchase(store, purchaseId);
  await confirm(store, merchant, purchaseId);
  return getPurchase(store, purchaseId);
}

/** Only a draft — confirmed stock has its own history and is returned as a stock-out. */
export async function cancelPurchase(store, purchaseId) {
  const row = await findPurchase(store, purchaseId);
  if (row.status !== 'draft') throw conflict('Only a draft purchase can be cancelled. Return stock to the supplier with a stock-out.');
  const { error } = await supabaseAdmin.from('purchases').update({ status: 'cancelled' }).eq('id', purchaseId).eq('status', 'draft');
  fail(error, 'Could not cancel the purchase.');
  return getPurchase(store, purchaseId);
}
