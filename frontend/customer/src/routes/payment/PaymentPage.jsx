import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatPaise } from '../../lib/money.js';
import { ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import { FormError } from '../../components/FormError.jsx';
import './Payment.css';

/**
 * The payment screen — checklist 11.9.
 *
 * The rule this screen exists to respect: **an order is never marked paid on the
 * client's say-so.** The customer comes back from the gateway with a claim; this
 * screen asks the server to verify it, and then shows whatever the *order* says.
 * The provider decides, and the signed webhook is the other path to the same
 * answer.
 *
 * So there are four outcomes to handle, and the fourth is the one that gets
 * forgotten:
 *
 *   paid       the order left pending_payment and is placed
 *   failed     the order stayed put; the customer can try again
 *   cancelled  the order was cancelled
 *   pending    the provider has not decided, or the webhook has not arrived yet —
 *              so the screen polls rather than guessing
 *
 * The route is deliberately public: a return from a gateway can land in a fresh
 * tab before the session has been restored, and bouncing that to a login screen
 * would lose the customer at the worst possible moment.
 */
const POLL_MS = 3000;
const POLL_LIMIT = 10;

export function PaymentPage() {
  const { orderId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { status: authStatus } = useAuth();

  const [verifying, setVerifying] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [polls, setPolls] = useState(0);
  const verifiedFor = useRef(null);

  const order = useApiQuery(() => endpoints.orders.get(orderId), [orderId], {
    enabled: authStatus === 'signedIn',
  });

  const current = order.data?.order ?? null;
  const settled = current && current.status !== 'pending_payment';

  /**
   * The gateway's answer, as the client received it.
   *
   * For the mock provider this is the outcome the stand-in gateway was told to
   * produce. It is passed to `verify` as a *claim to check*, not as a result: the
   * server asks the provider and believes the provider.
   */
  const claimedOutcome = searchParams.get('outcome');

  const verify = useCallback(async () => {
    if (verifying) return;
    setVerifying(true);
    setActionError(null);

    try {
      await endpoints.payments.verify(orderId, claimedOutcome ? { outcome: claimedOutcome } : {});
      await order.refetch();
    } catch (caught) {
      setActionError(caught);
      // Even a failed verify can have moved the order — the webhook may have
      // arrived in the meantime — so the order is re-read either way.
      await order.refetch();
    } finally {
      setVerifying(false);
    }
  }, [claimedOutcome, order, orderId, verifying]);

  /**
   * Verify once on arrival, when the customer has come back from the gateway.
   *
   * Guarded by a ref rather than a dependency list: this must happen exactly once
   * per return, and an effect that re-ran would keep asking the provider about a
   * payment it has already answered.
   */
  useEffect(() => {
    if (authStatus !== 'signedIn' || !current) return;
    if (current.status !== 'pending_payment') return;
    if (verifiedFor.current === orderId) return;

    verifiedFor.current = orderId;
    verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately once
  }, [authStatus, current, orderId]);

  /**
   * While the order is still awaiting payment, keep asking.
   *
   * The webhook can arrive after the customer does, so "pending" is a state to
   * wait in rather than a verdict. Bounded, because a payment that never settles
   * must not poll for the rest of the session.
   */
  useEffect(() => {
    if (!current || current.status !== 'pending_payment') return undefined;
    if (polls >= POLL_LIMIT) return undefined;

    const timer = setTimeout(() => {
      setPolls((count) => count + 1);
      order.refresh();
    }, POLL_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.status, polls]);

  if (authStatus === 'loading') return <PaymentSkeleton />;

  // A fresh tab with no session: ask them to sign in, but keep them pointed at
  // this order rather than dropping them on the home screen.
  if (authStatus === 'signedOut') {
    return (
      <div className="payment">
        <h1>Sign in to see your payment</h1>
        <p className="muted">
          You came back from the payment page in a new tab, so we need you to sign in again.
        </p>
        <Link
          to="/login"
          state={{ from: `/payment/${orderId}${claimedOutcome ? `?outcome=${claimedOutcome}` : ''}` }}
          className="btn btn--block"
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (order.error && !current) {
    return (
      <ErrorState
        error={order.error}
        onRetry={order.error.status === 404 ? undefined : order.refetch}
        title={order.error.status === 404 ? 'That order is not here' : undefined}
      />
    );
  }

  // Waiting on the order itself, not on `loading`. The query is disabled until the
  // session resolves, so there is a render where `loading` is false and there is
  // still no order — the same trap as the chained query in checkout (D76).
  if (!current) return <PaymentSkeleton />;

  const outcome = outcomeOf(current);

  return (
    <div className="payment">
      <FormError error={actionError} />

      <div className={`payment__mark payment__mark--${outcome.tone}`} aria-hidden="true">
        {outcome.tone === 'done' ? <Tick /> : outcome.tone === 'waiting' ? <Clock /> : <Cross />}
      </div>

      <h1>{outcome.title}</h1>
      <p className="payment__lead">{outcome.body}</p>

      <dl className="payment__facts">
        <div>
          <dt>Order</dt>
          <dd className="numeric">{current.orderNumber}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd className="numeric">{formatPaise(current.totalPaise)}</dd>
        </div>
        <div>
          <dt>Shop</dt>
          <dd>{current.storeName}</dd>
        </div>
      </dl>

      {outcome.tone === 'waiting' ? (
        <p className="payment__polling" role="status">
          {verifying
            ? 'Checking with the payment provider…'
            : polls >= POLL_LIMIT
              ? 'Still not confirmed. It can take a few minutes — reopen this order to check again.'
              : 'Waiting for confirmation…'}
        </p>
      ) : null}

      <div className="payment__actions">
        {outcome.canRetry ? (
          <button
            type="button"
            className="btn btn--block"
            onClick={() => retryPayment(orderId, navigate, setActionError)}
            disabled={verifying}
          >
            Try paying again
          </button>
        ) : null}

        {outcome.tone === 'waiting' ? (
          <button type="button" className="btn btn--secondary btn--block" onClick={verify} disabled={verifying}>
            {verifying ? 'Checking…' : 'Check again now'}
          </button>
        ) : null}

        <Link to={`/orders/${orderId}`} className="btn btn--secondary btn--block">
          View the order
        </Link>
        <Link to="/orders" className="btn btn--ghost btn--block">
          All orders
        </Link>
      </div>
    </div>
  );
}

/** Starts a fresh payment attempt for an order that failed. */
async function retryPayment(orderId, navigate, setError) {
  try {
    const { data } = await endpoints.payments.initiate(orderId);
    const url = data?.clientPayload?.checkoutUrl;
    if (!url) throw new Error('The payment provider did not give us anywhere to go.');

    // The mock provider's page is inside this app; a real one is elsewhere.
    if (url.startsWith(window.location.origin)) navigate(url.slice(window.location.origin.length));
    else window.location.assign(url);
  } catch (caught) {
    setError(caught);
  }
}

/**
 * What to say, derived from the ORDER — not from the URL the customer arrived on.
 *
 * A gateway can send someone back to a success URL for a payment that never
 * completed, so the claim in the query string decides nothing here.
 */
export function outcomeOf(order) {
  if (!order) {
    return { tone: 'waiting', title: 'Checking your payment', body: 'One moment.', canRetry: false };
  }

  if (order.paymentStatus === 'paid') {
    return {
      tone: 'done',
      title: 'Payment received',
      body: `Your order is confirmed and ${order.storeName} has it now.`,
      canRetry: false,
    };
  }

  if (order.status === 'cancelled' || order.paymentStatus === 'cancelled') {
    return {
      tone: 'stopped',
      title: 'Payment cancelled',
      body: 'Nothing has been charged, and the order was not placed.',
      canRetry: false,
    };
  }

  if (order.paymentStatus === 'failed') {
    return {
      tone: 'stopped',
      title: 'Payment did not go through',
      body: 'Nothing has been charged. Your order is still here, so you can try again.',
      canRetry: true,
    };
  }

  // Still pending_payment, or the payment is processing: the provider has not
  // decided, or the webhook has not reached us yet.
  return {
    tone: 'waiting',
    title: 'Waiting on your payment',
    body: 'We are checking with the payment provider. This usually takes a few seconds.',
    canRetry: true,
  };
}

function PaymentSkeleton() {
  return (
    <LoadingBlock label="Checking your payment">
      <div className="payment">
        <Skeleton width="4rem" height="4rem" radius="var(--radius-full)" />
        <Skeleton width="60%" height="1.5rem" />
        <Skeleton width="80%" height="1rem" />
        <Skeleton height="6rem" radius="var(--radius-md)" />
      </div>
    </LoadingBlock>
  );
}

const markProps = {
  width: 30,
  height: 30,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

const Tick = () => (
  <svg {...markProps}>
    <path d="M5 13l4 4L19 7" />
  </svg>
);

const Cross = () => (
  <svg {...markProps}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const Clock = () => (
  <svg {...markProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
