import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, notFound, unprocessable, validationFailed } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

/**
 * A merchant's stock — MERCHANT_API.md, Inventory; MERCHANT_RULES §5; D-5.
 * `store` is the caller's own store (requireStoreOwner).
 *
 * On hand is what is on the shelf, reserved is what open orders hold, and
 * available = on hand − reserved is what can still be sold. Every change is a
 * ledger row; the ledger is append-only, so a mistake is corrected by a new
 * movement, never an edit. The movement itself is one SQL function
 * (migration 0032), which takes the variant's row lock and does the checks.
 */

// ── Shapes ───────────────────────────────────────────────────────────────────

function toStockVariant(variant, product) {
  const available = variant.quantity_on_hand - variant.reserved_quantity;
  return {
    id: variant.id,
    productId: product.id,
    productName: product.name,
    name: variant.name,
    sku: variant.sku ?? null,
    quantityOnHand: variant.quantity_on_hand,
    reservedQuantity: variant.reserved_quantity,
    availableQuantity: available,
    isLowStock: product.low_stock_threshold != null && available <= product.low_stock_threshold,
  };
}

function toEntry(row, { variants, products, orders }) {
  const variant = variants.get(row.variant_id);
  const product = products.get(row.product_id);
  return {
    id: row.id,
    movementType: row.movement_type,
    productId: row.product_id,
    productName: product?.name ?? null,
    variantId: row.variant_id,
    variantName: variant?.name ?? null,
    sku: variant?.sku ?? null,
    onHandChange: row.on_hand_change,
    reservedChange: row.reserved_change,
    onHandAfter: row.on_hand_after,
    reservedAfter: row.reserved_after,
    availableAfter: row.on_hand_after - row.reserved_after,
    unitCostPaise: row.unit_cost_paise ?? null,
    reason: row.reason ?? null,
    notes: row.notes ?? null,
    reference: row.reference_type
      ? {
          type: row.reference_type,
          id: row.reference_id,
          number: row.reference_type === 'order' ? orders.get(row.reference_id) ?? null : null,
        }
      : null,
    performedBy: { type: row.performed_by_type, id: row.performed_by_id ?? null },
    createdAt: row.created_at,
  };
}

const LEDGER_COLUMNS = `
  id, store_id, product_id, variant_id, movement_type, on_hand_change, reserved_change,
  on_hand_after, reserved_after, unit_cost_paise, reason, notes, reference_type,
  reference_id, performed_by_type, performed_by_id, created_at
`;

/** Names and order numbers for a page of ledger rows, in three lookups. */
async function hydrate(rows) {
  const ids = (key) => [...new Set(rows.map((row) => row[key]).filter(Boolean))];
  const orderIds = [...new Set(rows.filter((row) => row.reference_type === 'order').map((row) => row.reference_id))];

  const lookup = async (table, columns, keys) => {
    if (keys.length === 0) return [];
    const { data, error } = await supabaseAdmin.from(table).select(columns).in('id', keys);
    if (error) throw internal('Could not load the stock history.');
    return data ?? [];
  };

  const [variants, products, orders] = await Promise.all([
    lookup('product_variants', 'id, name, sku', ids('variant_id')),
    lookup('products', 'id, name', ids('product_id')),
    lookup('orders', 'id, order_number', orderIds),
  ]);

  return {
    variants: new Map(variants.map((row) => [row.id, row])),
    products: new Map(products.map((row) => [row.id, row])),
    orders: new Map(orders.map((row) => [row.id, row.order_number])),
  };
}

// ── Movements ────────────────────────────────────────────────────────────────

/** The SQL function's refusals, as the 404 / 422 the merchant can act on. */
function translateMovementError(error) {
  const message = error?.message ?? '';
  const [code, number] = (message.match(/[A-Z_]+(?::-?\d+)?/)?.[0] ?? '').split(':');

  switch (code) {
    case 'VARIANT_NOT_FOUND':
      return notFound('Product variant');
    case 'NOT_TRACKED':
      return unprocessable('NOT_TRACKED', 'Stock is not counted for this product. Turn stock tracking on first.');
    case 'INSUFFICIENT_STOCK':
      return unprocessable(
        'INSUFFICIENT_STOCK',
        `Only ${number} can be taken out — the rest is held for open orders.`,
        { availableQuantity: Number(number) },
      );
    case 'BELOW_RESERVED':
      return unprocessable(
        'BELOW_RESERVED',
        `Open orders hold ${number}, so the count cannot be lower than that.`,
        { reservedQuantity: Number(number) },
      );
    case 'NO_CHANGE':
      return validationFailed({
        issues: [{ source: 'body', field: 'newQuantity', message: 'That is already the quantity on hand.' }],
      });
    default:
      logger.error('record_stock_movement failed', { code: error?.code, message });
      return internal('Could not record the stock change.');
  }
}

async function variantWithProduct(variantId) {
  const { data: variant, error } = await supabaseAdmin
    .from('product_variants')
    .select('id, product_id, name, sku, quantity_on_hand, reserved_quantity')
    .eq('id', variantId)
    .single();
  if (error) throw internal('Could not load the variant.');

  const { data: product, error: productError } = await supabaseAdmin
    .from('products')
    .select('id, name, low_stock_threshold')
    .eq('id', variant.product_id)
    .single();
  if (productError) throw internal('Could not load the product.');

  return toStockVariant(variant, product);
}

async function entryById(id) {
  const { data, error } = await supabaseAdmin.from('inventory_ledger').select(LEDGER_COLUMNS).eq('id', id).single();
  if (error) throw internal('Could not load the stock movement.');
  return toEntry(data, await hydrate([data]));
}

/**
 * Stock in, stock out or a count. Returns the variant as it now stands and the
 * ledger row that got it there.
 */
export async function recordMovement(store, merchant, kind, input) {
  const { data, error } = await supabaseAdmin.rpc('record_stock_movement', {
    payload: {
      store_id: store.id,
      variant_id: input.variantId,
      merchant_id: merchant.id,
      kind,
      quantity: input.quantity ?? null,
      new_quantity: input.newQuantity ?? null,
      unit_cost_paise: input.unitCostPaise ?? null,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
    },
  });
  if (error) throw translateMovementError(error);

  const result = Array.isArray(data) ? data[0] : data;
  const [variant, entry] = await Promise.all([variantWithProduct(input.variantId), entryById(result.ledger_id)]);
  return { variant, entry };
}

// ── History ──────────────────────────────────────────────────────────────────

/** A variant or product id from another store is a 404, never an empty list. */
async function assertInStore(store, { variantId, productId }) {
  if (productId) {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('id')
      .eq('id', productId)
      .eq('store_id', store.id)
      .maybeSingle();
    if (error) throw internal('Could not load the product.');
    if (!data) throw notFound('Product');
  }
  if (variantId) {
    const { data, error } = await supabaseAdmin
      .from('product_variants')
      .select('id')
      .eq('id', variantId)
      .eq('store_id', store.id)
      .maybeSingle();
    if (error) throw internal('Could not load the variant.');
    if (!data) throw notFound('Product variant');
  }
}

/** `GET …/inventory/history` — newest first, every movement including orders'. */
export async function listHistory(store, { variantId, productId, movementType, from, to, page, limit }) {
  await assertInStore(store, { variantId, productId });

  let query = supabaseAdmin
    .from('inventory_ledger')
    .select(LEDGER_COLUMNS, { count: 'exact' })
    .eq('store_id', store.id);

  if (variantId) query = query.eq('variant_id', variantId);
  if (productId) query = query.eq('product_id', productId);
  if (movementType) query = query.eq('movement_type', movementType);
  if (from) query = query.gte('created_at', new Date(from).toISOString());
  if (to) query = query.lte('created_at', new Date(to).toISOString());

  const start = (page - 1) * limit;
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(start, start + limit - 1);
  if (error) throw internal('Could not load the stock history.');

  const rows = data ?? [];
  const names = await hydrate(rows);
  return { entries: rows.map((row) => toEntry(row, names)), total: count ?? rows.length };
}
