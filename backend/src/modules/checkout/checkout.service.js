import { unprocessable } from '../../lib/errors.js';
import { priceTotals, meetsMinimumOrder, formatPaise } from '../../lib/pricing.js';
import { resolveOpenState } from '../../lib/openingHours.js';
import { loadCart } from '../cart/cart.service.js';
import { findOwnedAddress, toPublicAddress } from '../addresses/address.service.js';

/**
 * Checkout preparation — checklist 6.7 – 6.9.
 *
 * `buildQuote` is the gate every order passes through. The `POST /checkout/quote`
 * endpoint returns it so the customer can see the bill before committing, and
 * order creation (phase 7) calls the SAME function and refuses to write
 * anything unless it comes back `canPlaceOrder`. One implementation means the
 * price shown and the price charged cannot drift apart.
 */

/** Checklist 6.8. Pickup and delivery are each opt-in per store. */
function fulfilmentIssue(store, fulfilmentMode) {
  if (fulfilmentMode === 'pickup' && !store.pickup_enabled) {
    return {
      code: 'PICKUP_UNAVAILABLE',
      message: `${store.name} does not offer pickup.`,
    };
  }
  if (fulfilmentMode === 'delivery' && !store.delivery_enabled) {
    return {
      code: 'DELIVERY_UNAVAILABLE',
      message: `${store.name} does not offer delivery.`,
    };
  }
  return null;
}

/**
 * The address snapshot written onto the order (D11). Taken here rather than at
 * write time so the quote shows exactly what will be stored.
 */
export const addressSnapshot = (address) => ({
  id: address.id,
  label: address.label ?? null,
  recipientName: address.recipient_name,
  phone: address.phone,
  line1: address.line1,
  line2: address.line2 ?? null,
  landmark: address.landmark ?? null,
  city: address.city,
  state: address.state,
  postalCode: address.postal_code,
  country: address.country,
});

/** The store details a customer needs after ordering — where to collect, who to call. */
export const storeSnapshot = (store) => ({
  id: store.id,
  slug: store.slug,
  name: store.name,
  phone: store.phone ?? null,
  email: store.email ?? null,
  addressLine1: store.address_line1 ?? null,
  addressLine2: store.address_line2 ?? null,
  city: store.city ?? null,
  state: store.state ?? null,
  postalCode: store.postal_code ?? null,
});

/**
 * Prices the cart for one fulfilment mode and reports every reason it could not
 * be ordered — all of them at once, so the checkout screen can list what to fix
 * instead of revealing one problem per attempt.
 */
export async function buildQuote(customerId, { storeId, fulfilmentMode, addressId, customerNote }) {
  const { store, cart, lines } = await loadCart(customerId, storeId);

  const blockers = [];
  const warnings = [];

  // Item-level problems come straight from the cart, already per-line (5.10).
  for (const line of lines) {
    for (const issue of line.issues) {
      // A price change needs the customer's eyes, not a blocked checkout: the
      // quote shows the new price and they decide.
      const bucket = issue.code === 'PRICE_CHANGED' ? warnings : blockers;
      bucket.push({ itemId: line.id, ...issue });
    }
  }

  if (lines.length === 0) {
    blockers.push({ code: 'CART_EMPTY', message: 'Your cart is empty.' });
  }

  const modeIssue = fulfilmentIssue(store, fulfilmentMode);
  if (modeIssue) blockers.push(modeIssue);

  // Checklist 6.8. A delivery order without an address is unfulfillable, and
  // the orders_delivery_needs_address constraint would reject it anyway.
  let address = null;
  if (fulfilmentMode === 'delivery') {
    if (!addressId) {
      blockers.push({ code: 'ADDRESS_REQUIRED', message: 'Choose a delivery address.' });
    } else {
      // Another customer's address 404s here, exactly as it does on the address
      // routes — the quote must not become a way to test whether an id exists.
      address = await findOwnedAddress(customerId, addressId);
    }
  }

  const purchasable = lines.filter((line) => line.isPurchasable);
  const totals = priceTotals({ lines: purchasable, store, fulfilmentMode });

  // Checklist 6.9. Measured on the subtotal, so the delivery fee cannot be what
  // carries an order over the store's floor.
  if (purchasable.length > 0 && !meetsMinimumOrder(store, totals.subtotalPaise)) {
    blockers.push({
      code: 'MINIMUM_ORDER_NOT_MET',
      message: `Orders from ${store.name} start at ${formatPaise(store.min_order_paise)}.`,
      minOrderPaise: store.min_order_paise,
      shortfallPaise: store.min_order_paise - totals.subtotalPaise,
    });
  }

  // A closed store is a warning, not a blocker (D29): the order simply waits in
  // 'placed' until the merchant opens and accepts it.
  const openState = resolveOpenState(store.opening_hours, store.timezone);
  if (!openState.isOpen) {
    warnings.push({
      code: 'STORE_CLOSED',
      message: `${store.name} is closed right now. Your order will be confirmed when they open.`,
      opensAt: openState.opensAt ?? null,
    });
  }

  return {
    storeId: store.id,
    cartId: cart?.id ?? null,
    store: storeSnapshot(store),
    hours: { isOpen: openState.isOpen, opensAt: openState.opensAt ?? null },
    fulfilmentMode,
    address: address ? toPublicAddress(address) : null,
    customerNote: customerNote ?? null,
    lines: purchasable,
    unavailableLines: lines.filter((line) => !line.isPurchasable),
    totals,
    blockers,
    warnings,
    canPlaceOrder: blockers.length === 0,
    // Everything order creation needs, so it never re-derives pricing.
    _internal: { store, address, lines: purchasable, totals },
  };
}

/** The public shape — `_internal` is for order creation only, never the wire. */
export function toPublicQuote(quote) {
  const { _internal, ...rest } = quote;
  return rest;
}

/** Checklist 6.7 */
export async function quoteCheckout(customerId, input) {
  return toPublicQuote(await buildQuote(customerId, input));
}

/**
 * Used by order creation (7.4): the same blockers that grey out the checkout
 * button must also refuse the write, in case a client calls POST /orders
 * without quoting first.
 */
export function assertQuotePlaceable(quote) {
  if (quote.canPlaceOrder) return;

  const [first] = quote.blockers;
  throw unprocessable(first.code, first.message, { blockers: quote.blockers });
}
