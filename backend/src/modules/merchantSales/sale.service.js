import { supabaseAdmin } from '../../lib/supabase.js';
import { conflict, internal, notFound, unprocessable } from '../../lib/errors.js';
import { priceLine } from '../../lib/pricing.js';
import { logger } from '../../lib/logger.js';
import { isDefaultVariant } from '../stores/store.service.js';

/**
 * Counter (POS) sales — MERCHANT_API.md, P1 endpoints; MERCHANT_RULES §8.
 * `store` is the caller's own store (requireStoreOwner).
 *
 * Priced by the same engine as an online order — tax per line, on top (D-4) —
 * and written by one SQL function (migration 0033) that sells only what is
 * AVAILABLE, so a counter sale never takes stock an online order holds (X-6).
 */

const SALE_COLUMNS = `
  id, store_id, invoice_number, payment_method, customer_name, customer_phone, notes,
  subtotal_paise, discount_paise, tax_paise, total_paise, performed_by, created_at
`;

const toSaleItem = (row) => ({
  id: row.id,
  productId: row.product_id ?? null,
  variantId: row.variant_id ?? null,
  productName: row.product_name,
  variantName: row.variant_name ?? null,
  sku: row.sku ?? null,
  quantity: row.quantity,
  unitPricePaise: row.unit_price_paise,
  lineSubtotalPaise: row.unit_price_paise * row.quantity,
  taxPercent: Number(row.tax_percent ?? 0),
  taxPaise: row.tax_paise,
  lineTotalPaise: row.line_total_paise,
});

function toSale(row, items = null, itemCount = null) {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    paymentMethod: row.payment_method,
    customerName: row.customer_name ?? null,
    customerPhone: row.customer_phone ?? null,
    notes: row.notes ?? null,
    totals: {
      subtotalPaise: row.subtotal_paise,
      discountPaise: row.discount_paise,
      taxPaise: row.tax_paise,
      totalPaise: row.total_paise,
    },
    itemCount: items ? items.length : itemCount,
    ...(items ? { items: items.map(toSaleItem) } : {}),
    createdAt: row.created_at,
  };
}

/** The store's own variants for these ids, with their products — anything else is a 404. */
async function loadVariants(store, variantIds) {
  const { data: variants, error } = await supabaseAdmin
    .from('product_variants')
    .select('id, product_id, name, sku, price_paise, store_id')
    .in('id', variantIds)
    .eq('store_id', store.id);
  if (error) throw internal('Could not load the items.');
  if ((variants ?? []).length !== variantIds.length) throw notFound('Product variant');

  const productIds = [...new Set(variants.map((variant) => variant.product_id))];
  const { data: products, error: productError } = await supabaseAdmin
    .from('products')
    .select('id, name, tax_percent')
    .in('id', productIds);
  if (productError) throw internal('Could not load the items.');

  const byId = new Map((products ?? []).map((product) => [product.id, product]));
  return new Map(variants.map((variant) => [variant.id, { variant, product: byId.get(variant.product_id) }]));
}

function translateSaleError(error) {
  const message = error?.message ?? '';
  if (message.includes('INSUFFICIENT_STOCK:')) {
    const detail = message.slice(message.indexOf('INSUFFICIENT_STOCK:') + 'INSUFFICIENT_STOCK:'.length).split('\n')[0];
    const cut = detail.lastIndexOf(':');
    const productName = detail.slice(0, cut);
    const availableQuantity = Number(detail.slice(cut + 1));
    return unprocessable(
      'INSUFFICIENT_STOCK',
      `Only ${availableQuantity} of ${productName} can be sold — the rest is held for online orders.`,
      { productName, availableQuantity },
    );
  }
  if (message.includes('VARIANT_NOT_FOUND')) return notFound('Product variant');
  if (error?.code === '23505' && message.includes('idempotency')) {
    return conflict('This sale has already been recorded.');
  }
  logger.error('create_sale failed', { code: error?.code, message });
  return internal('Could not record the sale.');
}

/** `POST …/sales` — answers `{ sale, replayed }`; a replayed key returns the first sale. */
export async function createSale(store, merchant, input, { idempotencyKey = null } = {}) {
  const found = await loadVariants(store, input.items.map((item) => item.variantId));

  const lines = input.items.map(({ variantId, quantity }) => {
    const { variant, product } = found.get(variantId);
    return {
      variant,
      product,
      ...priceLine(variant.price_paise, quantity, product.tax_percent),
    };
  });

  const subtotalPaise = lines.reduce((sum, line) => sum + line.lineSubtotalPaise, 0);
  const taxPaise = lines.reduce((sum, line) => sum + line.taxPaise, 0);

  // MERCHANT_RULES X-4: refused, not clamped into a free sale.
  if (input.discountPaise > subtotalPaise + taxPaise) {
    throw unprocessable('DISCOUNT_TOO_LARGE', 'The discount is larger than the bill.', {
      maxDiscountPaise: subtotalPaise + taxPaise,
    });
  }

  const { data, error } = await supabaseAdmin.rpc('create_sale', {
    payload: {
      store_id: store.id,
      merchant_id: merchant.id,
      idempotency_key: idempotencyKey,
      payment_method: input.paymentMethod,
      customer_name: input.customerName ?? null,
      customer_phone: input.customerPhone ?? null,
      notes: input.notes ?? null,
      subtotal_paise: subtotalPaise,
      discount_paise: input.discountPaise,
      tax_paise: taxPaise,
      total_paise: subtotalPaise - input.discountPaise + taxPaise,
      items: lines.map((line) => ({
        product_id: line.product.id,
        variant_id: line.variant.id,
        product_name: line.product.name,
        variant_name: isDefaultVariant(line.variant) ? null : line.variant.name,
        sku: line.variant.sku ?? null,
        quantity: line.quantity,
        unit_price_paise: line.unitPricePaise,
        tax_percent: line.taxPercent,
        tax_paise: line.taxPaise,
        line_total_paise: line.lineTotalPaise,
      })),
    },
  });
  if (error) throw translateSaleError(error);

  const result = Array.isArray(data) ? data[0] : data;
  return { sale: await getSale(store, result.sale_id), replayed: Boolean(result.replayed) };
}

/** `GET …/sales/:saleId` — another store's sale is a 404. */
export async function getSale(store, saleId) {
  const { data: row, error } = await supabaseAdmin
    .from('sales')
    .select(SALE_COLUMNS)
    .eq('id', saleId)
    .eq('store_id', store.id)
    .maybeSingle();
  if (error) throw internal('Could not load the sale.');
  if (!row) throw notFound('Sale');

  const { data: items, error: itemError } = await supabaseAdmin
    .from('sale_items')
    .select('id, product_id, variant_id, product_name, variant_name, sku, quantity, unit_price_paise, tax_percent, tax_paise, line_total_paise, created_at')
    .eq('sale_id', saleId)
    .order('created_at', { ascending: true });
  if (itemError) throw internal('Could not load the sale.');

  return toSale(row, items ?? []);
}

/** `GET …/sales` — newest first. */
export async function listSales(store, { from, to, page, limit }) {
  let query = supabaseAdmin.from('sales').select(SALE_COLUMNS, { count: 'exact' }).eq('store_id', store.id);
  if (from) query = query.gte('created_at', new Date(from).toISOString());
  if (to) query = query.lte('created_at', new Date(to).toISOString());

  const start = (page - 1) * limit;
  const { data, count, error } = await query.order('created_at', { ascending: false }).range(start, start + limit - 1);
  if (error) throw internal('Could not load the sales.');

  const rows = data ?? [];
  const counts = new Map();
  if (rows.length > 0) {
    const { data: items, error: itemError } = await supabaseAdmin
      .from('sale_items')
      .select('sale_id')
      .in('sale_id', rows.map((row) => row.id));
    if (itemError) throw internal('Could not load the sales.');
    for (const { sale_id: id } of items ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return { sales: rows.map((row) => toSale(row, null, counts.get(row.id) ?? 0)), total: count ?? rows.length };
}
