import { supabaseAdmin } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';

/**
 * Cart behaviour events (roadmap §5 P6 "Behaviour events": cart additions and
 * abandoned-cart signals). Both are derived by the server from what actually
 * happened to a cart — a client cannot post them — so they cannot be faked or
 * double-counted. Both honour the customer's "remember my activity" choice
 * and carry no prices or personal details.
 */

/** An open cart with items and no activity for this long is abandoned. */
export const ABANDON_AFTER_HOURS = 24;
/** Carts idle for longer than this are not reported (no backfilling old carts). */
export const ABANDON_LOOKBACK_DAYS = 30;

async function trackingAllowed(customerIds) {
  const ids = [...new Set(customerIds)];
  if (ids.length === 0) return new Set();
  const { data, error } = await supabaseAdmin.from('customers').select('id, activity_tracking').in('id', ids);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).filter((c) => c.activity_tracking !== false).map((c) => c.id));
}

/**
 * Records that an item went into a cart. Called by the cart only after the
 * line was saved; a failure here is logged and never fails the add itself.
 */
export async function recordCartAdd(customerId, { storeId, productId, variantId, quantity }) {
  try {
    if (!(await trackingAllowed([customerId])).has(customerId)) return { recorded: false, reason: 'TRACKING_OFF' };
    const { error } = await supabaseAdmin.from('customer_events').insert({
      customer_id: customerId,
      store_id: storeId,
      product_id: productId,
      variant_id: variantId ?? null,
      event_type: 'cart_add',
      properties: { quantity },
    });
    if (error) throw new Error(error.message);
    return { recorded: true };
  } catch (error) {
    logger.warn('cart_add event not recorded', { reason: error.message });
    return { recorded: false, reason: 'ERROR' };
  }
}

/**
 * The scheduled sweep. A cart counts as abandoned when ALL of these hold:
 *   - it is still open (not checked out) and has at least one line;
 *   - its last activity — the latest of the cart and its lines — is at least
 *     ABANDON_AFTER_HOURS ago and no more than ABANDON_LOOKBACK_DAYS ago;
 *   - the customer has placed no order at that store since that activity;
 *   - the customer allows activity to be remembered.
 * One event per cart per idle spell: the dedupe key is the cart and its last
 * activity time, unique in the database, so re-runs and parallel runs record
 * nothing new; touching the cart starts a new spell.
 */
export async function recordAbandonedCarts({ now = new Date() } = {}) {
  const idleSince = new Date(now.getTime() - ABANDON_AFTER_HOURS * 3_600_000);
  const oldest = new Date(now.getTime() - ABANDON_LOOKBACK_DAYS * 86_400_000);

  const { data: carts, error } = await supabaseAdmin
    .from('carts')
    .select('id, customer_id, store_id, updated_at')
    .is('checked_out_at', null)
    .gte('updated_at', oldest.toISOString());
  if (error) throw new Error(error.message);
  const open = carts ?? [];
  if (open.length === 0) return { recorded: 0, skipped: 0 };

  const { data: lines, error: lineError } = await supabaseAdmin
    .from('cart_items')
    .select('cart_id, quantity, created_at, updated_at')
    .in('cart_id', open.map((c) => c.id));
  if (lineError) throw new Error(lineError.message);
  const linesByCart = new Map();
  for (const line of lines ?? []) {
    if (!linesByCart.has(line.cart_id)) linesByCart.set(line.cart_id, []);
    linesByCart.get(line.cart_id).push(line);
  }

  const allowed = await trackingAllowed(open.map((c) => c.customer_id));
  let recorded = 0;
  let skipped = 0;
  for (const cart of open) {
    const items = linesByCart.get(cart.id) ?? [];
    if (items.length === 0) continue;
    const lastActivity = [cart.updated_at, ...items.flatMap((i) => [i.created_at, i.updated_at])]
      .filter(Boolean)
      .map((t) => new Date(t))
      .reduce((a, b) => (b > a ? b : a));
    if (lastActivity > idleSince || lastActivity < oldest) continue;
    if (!allowed.has(cart.customer_id)) {
      skipped += 1;
      continue;
    }
    // Ordered since? Then the basket was not abandoned, whatever the cart row says.
    const { data: orders, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('customer_id', cart.customer_id)
      .eq('store_id', cart.store_id)
      .gte('placed_at', lastActivity.toISOString())
      .limit(1);
    if (orderError) throw new Error(orderError.message);
    if ((orders ?? []).length) continue;

    const { error: insertError } = await supabaseAdmin.from('customer_events').insert({
      customer_id: cart.customer_id,
      store_id: cart.store_id,
      event_type: 'cart_abandon',
      dedupe_key: `cart_abandon:${cart.id}:${lastActivity.toISOString()}`,
      properties: { cart_id: cart.id, item_count: items.length, last_activity_at: lastActivity.toISOString() },
    });
    if (insertError) {
      // Already recorded for this idle spell (unique dedupe_key): not an error.
      if (insertError.code === '23505' || /duplicate key|unique/i.test(insertError.message ?? '')) continue;
      throw new Error(insertError.message);
    }
    recorded += 1;
  }
  return { recorded, skipped };
}
