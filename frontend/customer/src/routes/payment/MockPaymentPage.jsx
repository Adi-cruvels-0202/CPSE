import { useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatPaise } from '../../lib/money.js';
import { ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import './Payment.css';

/**
 * The stand-in gateway — checklist 11.9, development only.
 *
 * `PAYMENT_MOCK_CHECKOUT_URL` points here, so this is where the mock provider's
 * `checkoutUrl` lands. It plays the part a real gateway plays: it shows the amount,
 * lets whoever is testing decide what the payment does, and hands the customer back
 * with that claim in the URL.
 *
 * It is a **simulator of the provider, not of our app**. The outcome chosen here is
 * still only a claim: the payment screen asks the server to verify it, and the
 * server asks the provider. Swapping in Razorpay or Stripe deletes this file and
 * changes nothing else — the real `checkoutUrl` simply points at them instead.
 *
 * Marked unmistakably as fake, because a payment page that looks real and is not
 * is the one screen you never want to ship by accident.
 */
const OUTCOMES = [
  { value: 'success', label: 'Pay successfully', tone: 'primary' },
  { value: 'failure', label: 'Decline the card', tone: 'danger' },
  { value: 'cancel', label: 'Cancel and go back', tone: 'secondary' },
  { value: 'pending', label: 'Leave it pending', tone: 'secondary' },
];

export function MockPaymentPage() {
  const [searchParams] = useSearchParams();
  const providerRef = searchParams.get('ref');
  const [returning, setReturning] = useState(null);

  /**
   * The gateway knows the payment by its provider reference, not by our order id —
   * so this screen has to find the order the same way, through the customer's own
   * order list. A real gateway would have been handed the amount up front.
   */
  const orders = useApiQuery(() => endpoints.orders.list({ status: 'pending_payment', limit: 20 }), []);

  const order = (orders.data?.orders ?? [])[0] ?? null;

  useEffect(() => {
    if (!returning || !order) return;
    // A real gateway redirects; this one does the same, back to our return URL.
    window.location.assign(`/payment/${order.id}?outcome=${returning}`);
  }, [returning, order]);

  if (!providerRef) {
    return (
      <ErrorState
        error={{ message: 'This page is opened by the payment step; there is no payment to show.' }}
        title="Nothing to pay for"
      />
    );
  }

  if (orders.loading) {
    return (
      <LoadingBlock label="Loading the payment">
        <Skeleton height="14rem" radius="var(--radius-lg)" />
      </LoadingBlock>
    );
  }

  return (
    <div className="mock-pay">
      <p className="mock-pay__banner" role="note">
        Test payment page — no money moves. This stands in for the real gateway while
        one is being chosen.
      </p>

      <div className="card stack">
        <h1 className="mock-pay__title">Mock Payments</h1>

        <dl className="payment__facts">
          <div>
            <dt>Reference</dt>
            <dd className="numeric mock-pay__ref">{providerRef}</dd>
          </div>
          {order ? (
            <>
              <div>
                <dt>Order</dt>
                <dd className="numeric">{order.orderNumber}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd className="numeric">{formatPaise(order.totalPaise)}</dd>
              </div>
            </>
          ) : null}
        </dl>

        {order ? (
          <>
            <p className="field__hint">Choose what this payment should do:</p>
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              {OUTCOMES.map((outcome) => (
                <button
                  key={outcome.value}
                  type="button"
                  className={`btn btn--block${
                    outcome.tone === 'primary'
                      ? ''
                      : outcome.tone === 'danger'
                        ? ' btn--danger'
                        : ' btn--secondary'
                  }`}
                  onClick={() => setReturning(outcome.value)}
                  disabled={Boolean(returning)}
                >
                  {returning === outcome.value ? 'Returning…' : outcome.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">
            No order is waiting for payment. It may already have been settled — open your orders to
            check.
          </p>
        )}
      </div>
    </div>
  );
}
