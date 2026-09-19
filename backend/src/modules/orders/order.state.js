/**
 * The order state machine — checklist 8.3.
 *
 * Pure data and pure functions: no database, no request. The transitions a
 * merchant may make, the ones a customer may make, and the ones nobody may
 * make are all decided here, so "can I cancel this?" has exactly one answer
 * wherever it is asked.
 *
 *   pending_payment ─▶ placed ─▶ accepted ─▶ preparing ─▶ ready_for_pickup ─▶ completed
 *                                                     └─▶ out_for_delivery ─▶ completed
 *   ... and rejected / cancelled from the early states.
 */

export const ORDER_STATUSES = [
  'pending_payment',
  'placed',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'out_for_delivery',
  'completed',
  'cancelled',
  'rejected',
];

/** Every legal next state, keyed by the current one. */
export const TRANSITIONS = {
  // An online order waiting on the gateway. It becomes 'placed' only when the
  // provider confirms (checklist 7.13).
  pending_payment: ['placed', 'cancelled', 'rejected'],
  placed: ['accepted', 'cancelled', 'rejected'],
  accepted: ['preparing', 'cancelled', 'rejected'],
  preparing: ['ready_for_pickup', 'out_for_delivery', 'cancelled'],
  ready_for_pickup: ['completed', 'cancelled'],
  out_for_delivery: ['completed', 'cancelled'],
  // Terminal.
  completed: [],
  cancelled: [],
  rejected: [],
};

/**
 * Checklist 8.4. A customer may call it off only while the store has not
 * started on it. Once it is being prepared, cancelling is the merchant's call —
 * the goods may already be packed.
 */
export const CUSTOMER_CANCELLABLE = ['pending_payment', 'placed', 'accepted'];

/** Delivery-only and pickup-only states, so the timeline never shows both. */
export const PICKUP_STATES = ORDER_STATUSES.filter((status) => status !== 'out_for_delivery');
export const DELIVERY_STATES = ORDER_STATUSES.filter((status) => status !== 'ready_for_pickup');

export const TERMINAL_STATUSES = ['completed', 'cancelled', 'rejected'];

export const isTerminal = (status) => TERMINAL_STATUSES.includes(status);

export const canTransition = (from, to) => (TRANSITIONS[from] ?? []).includes(to);

export const canCustomerCancel = (status) => CUSTOMER_CANCELLABLE.includes(status);

/** Checklist 8.5. The states this order can actually pass through. */
export function timelineFor(fulfilmentMode) {
  const happyPath =
    fulfilmentMode === 'delivery'
      ? ['placed', 'accepted', 'preparing', 'out_for_delivery', 'completed']
      : ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'completed'];
  return happyPath;
}

/** Customer-facing wording. The enum value is what the client should switch on. */
export const STATUS_LABELS = {
  pending_payment: 'Awaiting payment',
  placed: 'Order placed',
  accepted: 'Accepted by the store',
  preparing: 'Being prepared',
  ready_for_pickup: 'Ready for pickup',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rejected: 'Rejected by the store',
};

/**
 * Checklist 7.15. Which order status a payment outcome implies — and, just as
 * importantly, which ones it must not touch. A failed payment leaves the order
 * where it is so the customer can try again; only a confirmed payment moves an
 * order out of pending_payment.
 */
export function orderStatusForPayment(currentStatus, paymentStatus) {
  if (paymentStatus === 'paid' && currentStatus === 'pending_payment') return 'placed';
  if (paymentStatus === 'cancelled' && currentStatus === 'pending_payment') return 'cancelled';
  return null;
}
