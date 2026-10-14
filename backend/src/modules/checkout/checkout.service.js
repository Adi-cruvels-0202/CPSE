import { unprocessable } from '../../lib/errors.js';
import { priceTotals, meetsMinimumOrder, formatPaise, allocateDiscount, deliveryFeeFor } from '../../lib/pricing.js';
import { evaluateBenefits } from '../benefits/benefits.service.js';
import { resolveOpenState } from '../../lib/openingHours.js';
import { loadCart } from '../cart/cart.service.js';
import { holidaysFor } from '../stores/store.service.js';
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
export async function buildQuote(
  customerId,
  { storeId, fulfilmentMode, addressId, customerNote, couponCode = null, redeemPoints = null, substitutionPreference = null },
) {
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

  const offerPriced = lines.filter((line) => line.isPurchasable);
  for (const line of offerPriced) {
    for (const notice of line.notices ?? []) warnings.push({ itemId: line.id, ...notice });
  }

  // Coupon and points (roadmap §5 P4), judged on the item value after offers.
  const itemSubtotal = offerPriced.reduce((sum, line) => sum + line.lineSubtotalPaise, 0);
  const benefits =
    couponCode || redeemPoints
      ? await evaluateBenefits(store, customerId, {
          couponCode,
          redeemPoints,
          subtotalPaise: itemSubtotal,
          deliveryFeePaise: deliveryFeeFor(store, fulfilmentMode, itemSubtotal),
          fulfilmentMode,
        })
      : null;
  for (const blocker of benefits?.blockers ?? []) blockers.push(blocker);
  const discountPaise = benefits && benefits.blockers.length === 0 ? benefits.discountPaise : 0;
  const waivedDeliveryPaise = benefits && benefits.blockers.length === 0 ? benefits.waivedDeliveryPaise : 0;

  // The discount's share of each line lowers that line's taxable value.
  const purchasable = allocateDiscount(offerPriced, discountPaise);
  const priced = priceTotals({ lines: purchasable, store, fulfilmentMode, discountPaise });
  const totals = {
    ...priced,
    deliveryFeePaise: priced.deliveryFeePaise - waivedDeliveryPaise,
    totalPaise: priced.totalPaise - waivedDeliveryPaise,
    waivedDeliveryPaise,
  };

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
  const openState = resolveOpenState(store.opening_hours, store.timezone, new Date(), {
    holidays: await holidaysFor(store.id),
  });
  if (!openState.isOpen) {
    warnings.push({
      code: 'STORE_CLOSED',
      message: `${store.name} is closed right now. Your order will be confirmed when they open.`,
      opensAt: openState.opensAt ?? null,
    });
  }

  // Roadmap §5 P4 "Fulfilment thresholds": how close delivery is to free.
  const threshold = store.free_delivery_threshold_paise ?? null;
  const freeDelivery =
    fulfilmentMode === 'delivery' && store.delivery_enabled && threshold !== null
      ? { thresholdPaise: threshold, remainingPaise: Math.max(threshold - totals.subtotalPaise, 0), isUnlocked: totals.subtotalPaise >= threshold }
      : null;

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
    freeDelivery,
    benefits: benefits ? { coupon: benefits.coupon, loyalty: benefits.loyalty } : null,
    substitutionPreference: substitutionPreference ?? null,
    blockers,
    warnings,
    canPlaceOrder: blockers.length === 0,
    // Everything order creation needs, so it never re-derives pricing.
    _internal: { store, address, lines: purchasable, totals, benefits },
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

/**
 * Roadmap §5 P2 "Quick checkout": the choices this customer usually makes —
 * fulfilment, default address, payment method — applied to this store where
 * it allows them, and the normal quote for them. Nothing is placed here; the
 * customer confirms the quote and places the order through the usual path.
 */
export async function quickQuote(customerId, { storeId }) {
  const { getPreferences } = await import('../engagement/engagement.service.js');
  const preferences = await getPreferences(customerId);
  const { store } = await loadCart(customerId, storeId);

  const modes = [store.pickup_enabled && 'pickup', store.delivery_enabled && 'delivery'].filter(Boolean);
  let fulfilmentMode = modes.includes(preferences.preferredFulfilment) ? preferences.preferredFulfilment : modes[0];
  const addressId = fulfilmentMode === 'delivery' ? preferences.defaultAddressId : null;
  // No saved address: pickup is the quick path if the store offers it.
  if (fulfilmentMode === 'delivery' && !addressId && modes.includes('pickup')) fulfilmentMode = 'pickup';

  const accepts = { cash: store.accepts_cash, online: store.accepts_online, khata: Boolean(store.khata_enabled) };
  const paymentMethod = accepts[preferences.preferredPaymentMethod]
    ? preferences.preferredPaymentMethod
    : store.accepts_cash
      ? 'cash'
      : 'online';

  const quote = await quoteCheckout(customerId, {
    storeId,
    fulfilmentMode,
    addressId: fulfilmentMode === 'delivery' ? addressId : null,
    substitutionPreference: preferences.preferredSubstitution,
  });
  return {
    settings: {
      fulfilmentMode,
      addressId: fulfilmentMode === 'delivery' ? addressId : null,
      paymentMethod,
      substitutionPreference: preferences.preferredSubstitution,
    },
    quote,
  };
}
