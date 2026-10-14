import { supabaseAdmin } from '../../lib/supabase.js';
import { conflict, internal, notFound, unprocessable, AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import * as notifications from '../notifications/notification.service.js';
import { emitToStore } from '../notifications/merchantNotification.service.js';
import { refundsForOrder, settleRefund } from '../refunds/refund.service.js';

/**
 * Transparent substitutions — roadmap §5 P5: substitutions are explicit and
 * the customer approves them where required.
 *
 *   - "No substitutions": the shop cannot propose one.
 *   - "Contact me" (default): every proposal waits for the customer.
 *   - "Allow similar": a replacement that costs no more is applied at once
 *     (and the customer is told); anything else still waits.
 *
 * The customer never pays more because of a substitution: a dearer
 * replacement is charged at the original line's price. Applying one is a
 * single SQL transaction (apply_substitution, migration 0043) that moves the
 * stock reservation, recomputes the bill and, for a prepaid order that now
 * costs less, opens an adjustment refund for the difference.
 */

const COLUMNS = `
  id, order_id, order_item_id, store_id, customer_id, proposed_product_id, proposed_variant_id,
  proposed_name, proposed_variant_name, proposed_quantity, proposed_unit_price_paise, original_line_paise,
  merchant_note, customer_note, status, auto_approved, new_order_item_id, created_at, responded_at
`;

const fail = (error, message) => {
  if (error) throw internal(message);
};

export const toSubstitution = (row, original = null) => ({
  id: row.id,
  orderId: row.order_id,
  orderItemId: row.order_item_id,
  original: original
    ? { name: original.product_name, variantName: original.variant_name ?? null, quantity: original.quantity, unitPricePaise: original.unit_price_paise }
    : null,
  proposed: {
    productId: row.proposed_product_id,
    variantId: row.proposed_variant_id,
    name: row.proposed_name,
    variantName: row.proposed_variant_name ?? null,
    quantity: row.proposed_quantity,
    unitPricePaise: row.proposed_unit_price_paise,
    linePaise: row.proposed_unit_price_paise * row.proposed_quantity,
  },
  originalLinePaise: row.original_line_paise,
  // Positive: the customer pays this much less.
  savingPaise: row.original_line_paise - row.proposed_unit_price_paise * row.proposed_quantity,
  merchantNote: row.merchant_note ?? null,
  customerNote: row.customer_note ?? null,
  status: row.status,
  autoApproved: row.auto_approved,
  createdAt: row.created_at,
  respondedAt: row.responded_at ?? null,
});

async function withOriginals(rows) {
  if (rows.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('order_items')
    .select('id, product_name, variant_name, quantity, unit_price_paise')
    .in('id', rows.map((r) => r.order_item_id));
  fail(error, 'Could not load the substitutions.');
  const byId = new Map((data ?? []).map((row) => [row.id, row]));
  return rows.map((row) => toSubstitution(row, byId.get(row.order_item_id)));
}

export async function substitutionsForOrder(orderId) {
  const { data, error } = await supabaseAdmin.from('order_substitutions').select(COLUMNS).eq('order_id', orderId).order('created_at', { ascending: true });
  fail(error, 'Could not load the substitutions.');
  return withOriginals(data ?? []);
}

async function applyNow(substitutionId, actor) {
  const { error } = await supabaseAdmin.rpc('apply_substitution', { p_substitution_id: substitutionId, p_actor: actor });
  if (error) {
    const message = error.message ?? '';
    if (message.includes('SUBSTITUTE_UNAVAILABLE')) throw unprocessable('SUBSTITUTE_UNAVAILABLE', 'The replacement is no longer in stock.');
    if (message.includes('ORDER_LOCKED')) throw conflict('This order can no longer be changed.');
    if (message.includes('SUBSTITUTION_NOT_PENDING')) throw conflict('This substitution has already been answered.');
    logger.error('apply_substitution failed', { message });
    throw internal('Could not apply the substitution.');
  }
}

/** Sends any adjustment refund the substitution opened to the provider. */
async function settleAdjustments(orderId, substitutionId) {
  const refunds = await refundsForOrder(orderId);
  for (const refund of refunds) {
    if (refund.kind === 'adjustment' && refund.status === 'initiated' && refund.substitution_id === substitutionId) {
      await settleRefund(refund);
    }
  }
}

// ── Merchant ────────────────────────────────────────────────────────────────

export async function propose(store, orderId, { orderItemId, variantId, quantity, note }) {
  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, store_id, customer_id, status, substitution_preference')
    .eq('id', orderId)
    .eq('store_id', store.id)
    .maybeSingle();
  fail(error, 'Could not load the order.');
  if (!order) throw notFound('Order');
  if (!['placed', 'accepted', 'preparing'].includes(order.status)) {
    throw conflict('Substitutions can only be proposed before the order is ready.');
  }
  if (order.substitution_preference === 'no_substitutions') {
    throw new AppError(409, 'NO_SUBSTITUTIONS', 'The customer asked for no substitutions. Remove the item or contact them.');
  }

  const { data: item } = await supabaseAdmin
    .from('order_items')
    .select('id, order_id, variant_id, product_name, variant_name, quantity, unit_price_paise, is_active')
    .eq('id', orderItemId)
    .eq('order_id', orderId)
    .maybeSingle();
  if (!item || !item.is_active) throw notFound('Order item');
  if (item.variant_id === variantId) throw unprocessable('SAME_ITEM', 'Choose a different product to substitute.');

  const { data: variant } = await supabaseAdmin
    .from('product_variants')
    .select('id, product_id, name, price_paise, store_id, is_available')
    .eq('id', variantId)
    .eq('store_id', store.id)
    .maybeSingle();
  if (!variant || !variant.is_available) throw notFound('Product variant');
  const { data: product } = await supabaseAdmin.from('products').select('id, name, archived_at, is_available').eq('id', variant.product_id).maybeSingle();
  if (!product || product.archived_at || !product.is_available) throw notFound('Product variant');

  const qty = quantity ?? item.quantity;
  const originalLine = item.unit_price_paise * item.quantity;
  // The customer never pays more: a dearer replacement is charged at the original line's price.
  const unitPrice = variant.price_paise * qty <= originalLine ? variant.price_paise : Math.floor(originalLine / qty);

  const { data: sub, error: insertError } = await supabaseAdmin
    .from('order_substitutions')
    .insert({
      order_id: orderId,
      order_item_id: item.id,
      store_id: store.id,
      customer_id: order.customer_id,
      proposed_product_id: product.id,
      proposed_variant_id: variant.id,
      proposed_name: product.name,
      proposed_variant_name: variant.name === 'Default' ? null : variant.name,
      proposed_quantity: qty,
      proposed_unit_price_paise: unitPrice,
      original_line_paise: originalLine,
      merchant_note: note ?? null,
    })
    .select(COLUMNS)
    .maybeSingle();
  if (insertError?.code === '23505') throw conflict('A substitution for this item is already waiting for the customer.');
  fail(insertError, 'Could not propose the substitution.');

  const automatic = order.substitution_preference === 'allow_similar' && variant.price_paise * qty <= originalLine;
  if (automatic) {
    await applyNow(sub.id, 'system');
    await settleAdjustments(orderId, sub.id);
  }

  await notifications.emit(order.customer_id, {
    type: 'substitution_requested',
    title: automatic
      ? `${store.name} replaced ${item.product_name} with ${product.name}`
      : `${store.name} suggests ${product.name} instead of ${item.product_name}`,
    body: automatic ? 'You allowed similar items. It costs you no more.' : 'Approve or decline it on your order.',
    payload: { order_id: orderId, order_number: order.order_number, substitution_id: sub.id },
  });

  return (await substitutionsForOrder(orderId)).find((s) => s.id === sub.id);
}

export async function withdraw(store, substitutionId) {
  const { data, error } = await supabaseAdmin
    .from('order_substitutions')
    .update({ status: 'withdrawn', responded_at: new Date().toISOString() })
    .eq('id', substitutionId)
    .eq('store_id', store.id)
    .eq('status', 'pending')
    .select(COLUMNS)
    .maybeSingle();
  fail(error, 'Could not withdraw the substitution.');
  if (!data) throw notFound('Pending substitution');
  return (await withOriginals([data]))[0];
}

// ── Customer ────────────────────────────────────────────────────────────────

export async function respond(customerId, substitutionId, { approve, note }) {
  const { data: sub, error } = await supabaseAdmin
    .from('order_substitutions')
    .select(COLUMNS)
    .eq('id', substitutionId)
    .eq('customer_id', customerId)
    .maybeSingle();
  fail(error, 'Could not load the substitution.');
  if (!sub) throw notFound('Substitution');
  if (sub.status !== 'pending') throw conflict('This substitution has already been answered.');

  if (note) await supabaseAdmin.from('order_substitutions').update({ customer_note: note }).eq('id', sub.id);
  if (approve) {
    await applyNow(sub.id, 'customer');
    await settleAdjustments(sub.order_id, sub.id);
  } else {
    const { error: rejectError } = await supabaseAdmin
      .from('order_substitutions')
      .update({ status: 'rejected', responded_at: new Date().toISOString() })
      .eq('id', sub.id)
      .eq('status', 'pending');
    fail(rejectError, 'Could not decline the substitution.');
  }

  await emitToStore(sub.store_id, {
    type: 'substitution_response',
    title: `Substitution ${approve ? 'approved' : 'declined'}: ${sub.proposed_name}`,
    body: note ?? null,
    payload: { order_id: sub.order_id, substitution_id: sub.id },
  });
  return (await substitutionsForOrder(sub.order_id)).find((s) => s.id === sub.id);
}
