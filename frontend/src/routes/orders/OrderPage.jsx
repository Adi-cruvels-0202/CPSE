import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { formatPaise } from '../../lib/money.js';
import { formatWhen, meaningFor, paymentFor, toneFor } from '../../lib/orderStatus.js';
import { RemoteImage } from '../../components/RemoteImage.jsx';
import { ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import { FormError } from '../../components/FormError.jsx';
import { OrderTimeline } from './OrderTimeline.jsx';
import './Orders.css';

/**
 * One order — checklist 11.10, and the confirmation screen for 11.8.
 *
 * It doubles as "your order is placed" because that is what it is: a customer who
 * has just ordered wants the same facts as one checking on it an hour later, plus
 * a word of confirmation. A separate success screen would be the same content with
 * a different heading.
 */
export function OrderPage() {
  const { orderId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const justPlaced = Boolean(location.state?.justPlaced);

  const { data, loading, error, refetch, refreshing } = useApiQuery(
    () => endpoints.orders.get(orderId),
    [orderId],
  );

  const [cancelling, setCancelling] = useState(false);

  const order = data?.order ?? null;

  const cancel = useSubmit(
    async () => {
      await endpoints.orders.cancel(orderId, {});
      await refetch();
      setCancelling(false);
    },
  );

  const reorder = useSubmit(
    async () => {
      const { data: result } = await endpoints.orders.reorder(orderId);
      return result;
    },
    {
      // Checklist 11.11. Straight to the cart, because that is where the rebuilt
      // basket is — and if anything could not be added, the cart is where the
      // customer will deal with it.
      onSuccess: (result) => navigate(`/cart/${result.storeId}`),
    },
  );

  if (loading) return <OrderSkeleton />;

  if (error || !order) {
    return (
      <ErrorState
        error={error ?? { message: 'That order could not be loaded.' }}
        onRetry={error?.status === 404 ? undefined : refetch}
        title={error?.status === 404 ? 'That order is not here' : undefined}
      />
    );
  }

  const payment = paymentFor(order.paymentStatus);
  const meaning = meaningFor(order.status);

  return (
    <div className="stack">
      {justPlaced ? (
        <div className="notice notice--success" role="status">
          <strong>Order placed.</strong> {order.storeName} has it now.
        </div>
      ) : null}

      <header className="order__head">
        <div className="spread">
          <h1>{order.orderNumber}</h1>
          <span className={`status status--${toneFor(order.status)}`}>{order.statusLabel}</span>
        </div>
        <p className="muted">
          {order.storeName} · {formatWhen(order.placedAt)}
        </p>
        {meaning ? <p className="order__meaning">{meaning}</p> : null}
      </header>

      {order.cancellationReason ? (
        <p className="notice notice--warning">Reason given: {order.cancellationReason}</p>
      ) : null}

      {/* An unpaid online order is the one state the customer must act on. */}
      {order.status === 'pending_payment' ? (
        <div className="notice notice--warning stack">
          <span>This order is not confirmed until the payment goes through.</span>
          <Link to={`/payment/${order.id}`} className="btn btn--sm">
            Finish paying
          </Link>
        </div>
      ) : null}

      <section className="card stack" aria-labelledby="progress-heading">
        <h2 id="progress-heading" className="order__section-title">
          Progress
        </h2>
        <OrderTimeline timeline={order.timeline} status={order.status} />
      </section>

      <section className="card stack" aria-labelledby="items-heading">
        <h2 id="items-heading" className="order__section-title">
          {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
        </h2>

        <ul className="order__items">
          {order.items.map((item) => (
            <li key={item.id}>
              <RemoteImage
                src={item.imageUrl}
                name={item.name}
                alt={item.name}
                ratio="1 / 1"
                className="order__item-image"
                rounded="var(--radius-sm)"
              />
              <span className="order__item-body">
                <span className="order__item-name">
                  {item.name}
                  {item.variantName ? <span className="muted"> · {item.variantName}</span> : null}
                </span>
                <span className="muted">
                  {item.quantity} × {formatPaise(item.unitPricePaise)}
                </span>
              </span>
              <span className="numeric">{formatPaise(item.lineTotalPaise)}</span>
            </li>
          ))}
        </ul>

        <dl className="order__totals">
          <Row label="Subtotal">{formatPaise(order.totals.subtotalPaise)}</Row>
          {order.totals.discountPaise > 0 ? (
            <Row label="Discount">−{formatPaise(order.totals.discountPaise)}</Row>
          ) : null}
          {order.totals.deliveryFeePaise > 0 ? (
            <Row label="Delivery">{formatPaise(order.totals.deliveryFeePaise)}</Row>
          ) : null}
          <Row label="Total" strong>
            {formatPaise(order.totals.totalPaise)}
          </Row>
        </dl>

        {payment ? (
          <p className={`order__payment status status--${payment.tone}`}>{payment.label}</p>
        ) : null}
      </section>

      <Fulfilment order={order} />

      {order.customerNote ? (
        <section className="card stack" aria-labelledby="note-heading">
          <h2 id="note-heading" className="order__section-title">
            Your note
          </h2>
          <p>{order.customerNote}</p>
        </section>
      ) : null}

      <div className="stack">
        <FormError error={cancel.error ?? reorder.error} />

        <Link to={`/orders/${order.id}/receipt`} className="btn btn--secondary btn--block">
          View receipt
        </Link>

        {/* Checklist 11.11 */}
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => reorder.submit()}
          disabled={reorder.pending}
        >
          {reorder.pending ? 'Rebuilding your cart…' : 'Order this again'}
        </button>

        {order.isCancellable ? (
          cancelling ? (
            <div className="notice notice--danger stack" role="alertdialog" aria-label="Cancel this order?">
              <p>Cancel {order.orderNumber}? The shop will be told.</p>
              <div className="row">
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => cancel.submit()}
                  disabled={cancel.pending}
                >
                  {cancel.pending ? 'Cancelling…' : 'Yes, cancel it'}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setCancelling(false)}
                  disabled={cancel.pending}
                >
                  Keep the order
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => setCancelling(true)}
            >
              Cancel this order
            </button>
          )
        ) : null}

        <div className="row">
          <Link to="/orders" className="btn btn--ghost btn--sm">
            All orders
          </Link>
          {order.store?.slug ? (
            <Link to={`/store/${order.store.slug}`} className="btn btn--ghost btn--sm">
              Back to the shop
            </Link>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={refetch}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Where it is going, or where to collect it.
 *
 * Both come from the order's own snapshot rather than the live store or address
 * (backend D11), so a deleted address or an edited shop cannot rewrite history.
 */
function Fulfilment({ order }) {
  const { fulfilment } = order;
  if (!fulfilment) return null;

  const delivery = fulfilment.mode === 'delivery';
  const target = delivery ? fulfilment.deliverTo ?? fulfilment.address : fulfilment.pickupFrom;
  if (!target) return null;

  return (
    <section className="card stack" aria-labelledby="fulfilment-heading">
      <h2 id="fulfilment-heading" className="order__section-title">
        {delivery ? 'Delivering to' : 'Collect from'}
      </h2>

      <address className="address__lines">
        {delivery ? <span>{target.recipientName}</span> : <span>{target.name}</span>}
        {[target.line1, target.addressLine1, target.line2, target.addressLine2, target.landmark]
          .filter(Boolean)
          .map((line) => (
            <span key={line}>{line}</span>
          ))}
        <span>{[target.city, target.state, target.postalCode].filter(Boolean).join(', ')}</span>
        {target.phone ? <span className="numeric muted">{target.phone}</span> : null}
      </address>

      {!delivery && target.phone ? (
        <a className="btn btn--secondary btn--sm" href={`tel:${target.phone}`}>
          Call the shop
        </a>
      ) : null}
    </section>
  );
}

function Row({ label, children, strong }) {
  return (
    <div className={`order__row${strong ? ' order__row--total' : ''}`}>
      <dt>{label}</dt>
      <dd className="numeric">{children}</dd>
    </div>
  );
}

function OrderSkeleton() {
  return (
    <LoadingBlock label="Loading your order">
      <div className="stack">
        <Skeleton width="55%" height="1.5rem" />
        <Skeleton width="35%" height="1rem" />
        <Skeleton height="10rem" radius="var(--radius-lg)" />
        <Skeleton height="12rem" radius="var(--radius-lg)" />
      </div>
    </LoadingBlock>
  );
}
