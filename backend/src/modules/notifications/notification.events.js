/**
 * The copy for every notification the portal emits — checklist 9.3.
 *
 * Kept as pure functions with no database and no request, so the wording can be
 * tested directly and a new event is one entry here rather than a string buried
 * in a service. Each returns the row body: `type` is the enum from migration
 * 0001, and `payload` carries only what a client needs to deep-link. No prices,
 * no addresses, no phone numbers — a notification list is the least protected
 * screen in the app, and it is polled.
 */
import { STATUS_LABELS } from '../orders/order.state.js';

const orderPayload = (order) => ({
  order_id: order.id,
  order_number: order.order_number,
  store_id: order.store_id ?? null,
});

/** The order exists and is on its way to the store. */
export function orderPlaced(order) {
  return {
    type: 'order_placed',
    title: `Order ${order.order_number} placed`,
    body: 'The store has been notified. We will tell you when it is accepted.',
    payload: orderPayload(order),
  };
}

/**
 * A merchant-driven status move. `cancelled` and `rejected` get their own type
 * so a client can style them differently without parsing the title.
 */
export function orderStatusChanged(order, toStatus, { note = null } = {}) {
  const label = STATUS_LABELS[toStatus] ?? toStatus;

  if (toStatus === 'cancelled' || toStatus === 'rejected') {
    return {
      type: 'order_cancelled',
      title: `Order ${order.order_number} ${toStatus}`,
      body: note ?? (toStatus === 'rejected'
        ? 'The store could not take this order.'
        : 'This order has been cancelled.'),
      payload: { ...orderPayload(order), status: toStatus },
    };
  }

  return {
    type: 'order_status_changed',
    title: `Order ${order.order_number}: ${label.toLowerCase()}`,
    body: BODY_BY_STATUS[toStatus] ?? null,
    payload: { ...orderPayload(order), status: toStatus },
  };
}

const BODY_BY_STATUS = {
  placed: 'The store has been notified.',
  accepted: 'The store has accepted your order.',
  preparing: 'Your order is being prepared.',
  ready_for_pickup: 'Your order is ready to collect.',
  out_for_delivery: 'Your order is on its way.',
  completed: 'Thank you for shopping with us.',
};

/** Checklist 9.3: payment state changes are notified too, not just order ones. */
export function paymentSucceeded(order) {
  return {
    type: 'payment_succeeded',
    title: `Payment received for ${order.order_number}`,
    body: 'Your payment has been confirmed.',
    payload: orderPayload(order),
  };
}

export function paymentFailed(order, { reason = null } = {}) {
  return {
    type: 'payment_failed',
    title: `Payment failed for ${order.order_number}`,
    // The provider's reason is shown because the customer has to act on it.
    // It is provider copy about a declined card, never card data.
    body: reason ?? 'The payment did not go through. You can try again.',
    payload: orderPayload(order),
  };
}

export function khataUpdated(account, { storeName }) {
  return {
    type: 'khata_updated',
    title: `Your khata at ${storeName} was updated`,
    body: null,
    payload: { khata_account_id: account.id, store_id: account.store_id },
  };
}
