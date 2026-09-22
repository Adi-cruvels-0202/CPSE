/**
 * Presenting an order's status. The state machine itself is the server's
 * (backend order.state.js) — this only decides how each state looks and reads.
 */

/** Which states mean "still happening", "done well", and "did not happen". */
const TONE = {
  pending_payment: 'waiting',
  placed: 'active',
  accepted: 'active',
  preparing: 'active',
  ready_for_pickup: 'ready',
  out_for_delivery: 'ready',
  completed: 'done',
  cancelled: 'stopped',
  rejected: 'stopped',
};

/**
 * A sentence about where the order actually is.
 *
 * `statusLabel` from the server is the name of the state; this is what it means
 * for the customer right now — which is a different thing, and the one they want.
 */
const MEANING = {
  pending_payment: 'Waiting for your payment. The shop has not been told about it yet.',
  placed: 'Sent to the shop. They will confirm it shortly.',
  accepted: 'The shop has accepted your order and will start on it.',
  preparing: 'Being put together now.',
  ready_for_pickup: 'Ready — you can collect it whenever you like.',
  out_for_delivery: 'On its way to you.',
  completed: 'Done. Thanks for shopping.',
  cancelled: 'This order was cancelled.',
  rejected: 'The shop could not take this order.',
};

export const toneFor = (status) => TONE[status] ?? 'active';
export const meaningFor = (status) => MEANING[status] ?? null;

export const isTerminal = (status) => ['completed', 'cancelled', 'rejected'].includes(status);

/** Payment states worth saying out loud, and how. */
const PAYMENT = {
  pending: { label: 'Payment pending', tone: 'waiting' },
  processing: { label: 'Payment in progress', tone: 'waiting' },
  paid: { label: 'Paid', tone: 'done' },
  failed: { label: 'Payment failed', tone: 'stopped' },
  cancelled: { label: 'Payment cancelled', tone: 'stopped' },
  refunded: { label: 'Refunded', tone: 'done' },
};

export const paymentFor = (status) => PAYMENT[status] ?? null;

/**
 * How long a refund takes to appear, in working days.
 *
 * A number, stated once, because it is a promise to a customer: the order screen
 * and the receipt must not quote different figures. It is the bank's clearing
 * time, not ours — the shop releases the refund, the bank decides when it lands,
 * which is why the wording says "usually" everywhere it is used.
 */
export const REFUND_WORKING_DAYS = 7;

/**
 * "20 Sep, 9:47 pm" — short, and in the reader's own timezone, because an order's
 * timestamps are about when *they* did something.
 */
export function formatWhen(iso) {
  if (!iso) return null;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** "20 Sep 2026" — for a receipt, where the year matters. */
export function formatDate(iso) {
  if (!iso) return null;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
