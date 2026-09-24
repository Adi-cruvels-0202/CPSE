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

/**
 * The steps a live order walks through, for the progress track on an order card.
 *
 * Pickup and delivery diverge at the end — one becomes "Ready", the other "On
 * its way" — so the track is built per order rather than being one fixed list.
 * `pending_payment` is deliberately absent: an order that has not been paid for
 * has not started, and drawing it as step one of five says it has.
 */
const TRACK = ['placed', 'accepted', 'preparing'];

export function progressFor(status, fulfilmentMode) {
  if (isTerminal(status) || status === 'pending_payment') return null;

  const last = fulfilmentMode === 'delivery' ? 'out_for_delivery' : 'ready_for_pickup';
  const steps = [...TRACK, last];
  const index = steps.indexOf(status);

  // A status the server added and this build does not know about: better to
  // draw no track at all than to draw a wrong one.
  if (index < 0) return null;

  return { step: index + 1, total: steps.length };
}

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

/**
 * How long ago, the way a feed says it: "Just now", "12 min ago", "3 h ago",
 * then the clock time for today and the date beyond that.
 *
 * A notification list is read by scanning, and "24 Sept, 11:21 pm" makes the
 * reader do arithmetic to answer the only question they have — is this new? The
 * absolute time is still there in the row's `title` attribute for anyone who
 * wants it.
 */
export function formatSince(iso, now = Date.now()) {
  if (!iso) return null;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const seconds = Math.round((now - date.getTime()) / 1000);

  // A clock a little behind the server's is ordinary; "in 3 seconds" is not.
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 21600) return `${Math.floor(seconds / 3600)} h ago`;

  if (isSameDay(date, new Date(now))) {
    return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** "Today" / "Yesterday" / "24 Sept" — the heading a run of rows sits under. */
export function formatDayGroup(iso, now = Date.now()) {
  if (!iso) return 'Earlier';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Earlier';

  const today = new Date(now);
  if (isSameDay(date, today)) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';

  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  });
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "20 Sep 2026" — for a receipt, where the year matters. */
export function formatDate(iso) {
  if (!iso) return null;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
