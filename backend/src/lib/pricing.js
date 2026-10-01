/**
 * The pricing engine — checklist 5.9. The ONLY place money is added up.
 *
 * The cart screen, the checkout quote and order creation all call these
 * functions, so the number a customer sees in the cart is produced by the same
 * code that writes `orders.total_paise`. A second implementation anywhere else
 * is how a bill ends up disagreeing with itself.
 *
 * Everything here is integer paise (decision D8) and pure: no database, no
 * clock, no request. That is what makes the totals unit-testable.
 *
 * Tax (MERGE_MAPPING D-4, superseding D27): each product carries a
 * `tax_percent`, and tax is ADDED ON TOP of the price — per line, rounded half
 * up to the paisa, on items only, never on the delivery fee. That is how
 * Merchant-One billed, and POS sales use this same function (MERCHANT_RULES §7).
 */

export const lineTotal = (unitPricePaise, quantity) => unitPricePaise * quantity;

/**
 * Tax on one line's subtotal, rounded half up to the paisa (D-4).
 *
 * Done in integers: the rate is turned into basis points (5.25 % → 525) so no
 * float ever touches money. `subtotal × bps` stays far below 2^53 for any order
 * this portal will see.
 */
export function taxFor(lineSubtotalPaise, taxPercent = 0) {
  const basisPoints = Math.round(Number(taxPercent ?? 0) * 100);
  if (basisPoints <= 0 || lineSubtotalPaise <= 0) return 0;
  return Math.floor((lineSubtotalPaise * basisPoints + 5000) / 10000);
}

/**
 * Everything money-related about one line. `lineTotalPaise` includes the tax
 * (MERCHANT_RULES O-16) — the same meaning on a cart line, an order line and a
 * POS sale line.
 */
export function priceLine(unitPricePaise, quantity, taxPercent = 0) {
  const lineSubtotalPaise = lineTotal(unitPricePaise, quantity);
  const taxPaise = taxFor(lineSubtotalPaise, taxPercent);
  return {
    unitPricePaise,
    quantity,
    lineSubtotalPaise,
    taxPercent: Number(taxPercent ?? 0),
    taxPaise,
    lineTotalPaise: lineSubtotalPaise + taxPaise,
  };
}

/**
 * Delivery fee: charged only for delivery, and only from the store's own rate.
 * Pickup is never charged a delivery fee, whatever the client asks for.
 *
 * Free once the subtotal reaches the store's free-delivery threshold, when it
 * has one (MERCHANT_RULES S-14 — Merchant-One stored the threshold and never
 * applied it). Measured on the subtotal, like the minimum order.
 */
export function deliveryFeeFor(store, fulfilmentMode, subtotalPaise = 0) {
  if (fulfilmentMode !== 'delivery') return 0;
  const threshold = store.free_delivery_threshold_paise ?? null;
  if (threshold !== null && subtotalPaise >= threshold) return 0;
  return store.delivery_fee_paise ?? 0;
}

/**
 * The single totals calculation. `lines` are what `priceLine` returns;
 * anything not purchasable must be excluded by the caller, because a cart may
 * legitimately hold an unavailable line while a priced order may not.
 *
 * The subtotal is before tax and the tax is the sum of the lines' own rounded
 * tax — never re-computed on the total, so the bill's lines add up to its
 * total exactly.
 */
export function priceTotals({ lines, store = null, fulfilmentMode = null, discountPaise = 0 }) {
  const subtotalPaise = lines.reduce(
    (sum, line) => sum + (line.lineSubtotalPaise ?? line.lineTotalPaise),
    0,
  );
  const deliveryFeePaise = store ? deliveryFeeFor(store, fulfilmentMode, subtotalPaise) : 0;
  const taxPaise = lines.reduce((sum, line) => sum + (line.taxPaise ?? 0), 0);
  const discount = Math.min(Math.max(discountPaise, 0), subtotalPaise);

  return {
    subtotalPaise,
    discountPaise: discount,
    deliveryFeePaise,
    taxPaise,
    // Must match the orders_total_adds_up CHECK constraint exactly (D17).
    totalPaise: subtotalPaise - discount + deliveryFeePaise + taxPaise,
    itemCount: lines.length,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}

/**
 * Minimum-order rule (checklist 6.9). Evaluated on the subtotal, not the total:
 * a delivery fee must not be what lifts an order over the store's floor.
 */
export function meetsMinimumOrder(store, subtotalPaise) {
  return subtotalPaise >= (store.min_order_paise ?? 0);
}

/** Paise → a display string. Used in customer-facing messages, never in maths. */
export const formatPaise = (paise) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
