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
 * Tax (D27): catalogue prices are GST-inclusive, the way Indian retail prices
 * are printed, so `taxPaise` is always 0. The field is still part of the
 * breakdown because `orders` has the column and a store that later prices
 * ex-tax only has to change this function.
 */

/** A variant sets an absolute price and overrides the parent's (decision D15). */
export function unitPriceOf(product, variant = null) {
  return variant ? variant.price_paise : product.price_paise;
}

export const lineTotal = (unitPricePaise, quantity) => unitPricePaise * quantity;

/**
 * Delivery fee: charged only for delivery, and only from the store's own rate.
 * Pickup is never charged a delivery fee, whatever the client asks for.
 */
export function deliveryFeeFor(store, fulfilmentMode) {
  return fulfilmentMode === 'delivery' ? store.delivery_fee_paise ?? 0 : 0;
}

/**
 * The single totals calculation. `lines` are objects carrying at least
 * `lineTotalPaise`; anything not purchasable must be excluded by the caller,
 * because a cart may legitimately hold an unavailable line while a priced
 * order may not.
 */
export function priceTotals({ lines, store = null, fulfilmentMode = null, discountPaise = 0 }) {
  const subtotalPaise = lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  const deliveryFeePaise = store ? deliveryFeeFor(store, fulfilmentMode) : 0;
  const taxPaise = 0;
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
