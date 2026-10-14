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

const refundPayload = (order, refund) => ({
  ...orderPayload(order),
  refund_id: refund.id,
  refund_status: refund.status,
});

const rupees = (paise) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Roadmap §5 P5 Refund Tracking Status. The amount is the customer's own money
 * coming back, which is exactly what they need to see — still no card or bank
 * detail, of which the portal has none.
 */
export function refundInitiated(order, refund) {
  return {
    type: 'refund_initiated',
    title: `Refund of ${rupees(refund.amount_paise)} started for ${order.order_number}`,
    body:
      refund.method === 'provider'
        ? 'We have asked the payment partner to return your money. We will tell you when it is confirmed.'
        : 'Your refund is being processed.',
    payload: refundPayload(order, refund),
  };
}

export function refundCompleted(order, refund) {
  return {
    type: 'refund_completed',
    title: `Refund of ${rupees(refund.amount_paise)} completed for ${order.order_number}`,
    body:
      refund.method === 'khata_credit'
        ? 'The amount has been credited to your khata at this store.'
        : refund.method === 'cash'
          ? 'The store has returned the amount in cash.'
          : 'The payment partner has confirmed the refund. Banks usually show it within 5–7 working days.',
    payload: refundPayload(order, refund),
  };
}

export function refundFailed(order, refund) {
  return {
    type: 'refund_failed',
    title: `Refund for ${order.order_number} did not go through`,
    body: 'The store has been told and will retry or contact you. You can also raise a support request from the order.',
    payload: refundPayload(order, refund),
  };
}
