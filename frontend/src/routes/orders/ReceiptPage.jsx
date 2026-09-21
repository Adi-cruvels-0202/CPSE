import { Link, useParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatPaise } from '../../lib/money.js';
import { formatDate, formatWhen } from '../../lib/orderStatus.js';
import { ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import './Receipt.css';

/**
 * The receipt — checklist 11.10.
 *
 * Derived from the order's own snapshot, never recalculated: the point of a
 * receipt is that it says what happened, and a price the shop has since changed
 * must not rewrite it.
 *
 * Laid out to survive being printed or screenshotted, which is what people
 * actually do with these. The browser's own print is the export — a PDF library
 * for one page is a dependency and a download nobody asked for.
 */
export function ReceiptPage() {
  const { orderId } = useParams();

  const { data, loading, error, refetch } = useApiQuery(
    () => endpoints.orders.receipt(orderId),
    [orderId],
  );

  if (loading) return <ReceiptSkeleton />;

  if (error || !data?.receipt) {
    return (
      <ErrorState
        error={error ?? { message: 'That receipt could not be loaded.' }}
        onRetry={error?.status === 404 ? undefined : refetch}
        title={error?.status === 404 ? 'That receipt is not here' : undefined}
      />
    );
  }

  const receipt = data.receipt;
  const store = receipt.store ?? {};
  const target =
    receipt.fulfilment?.mode === 'delivery'
      ? receipt.fulfilment.deliverTo ?? receipt.fulfilment.address
      : receipt.fulfilment?.pickupFrom;

  return (
    <div className="stack">
      <div className="receipt__actions">
        <Link to={`/orders/${orderId}`} className="btn btn--ghost btn--sm">
          Back to the order
        </Link>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => window.print()}>
          Print or save
        </button>
      </div>

      <article className="receipt">
        <header className="receipt__head">
          <h1>Receipt</h1>
          <p className="receipt__number numeric">{receipt.orderNumber}</p>
          <p className="muted">{formatDate(receipt.placedAt)} · {formatWhen(receipt.placedAt)}</p>
        </header>

        <section className="receipt__block">
          <h2>{store.name}</h2>
          <address className="address__lines">
            {[store.addressLine1, store.addressLine2].filter(Boolean).map((line) => (
              <span key={line}>{line}</span>
            ))}
            <span>{[store.city, store.state, store.postalCode].filter(Boolean).join(', ')}</span>
            {store.phone ? <span className="numeric">{store.phone}</span> : null}
          </address>
        </section>

        <table className="receipt__table">
          <caption className="sr-only">Items on this order</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="receipt__qty">
                Qty
              </th>
              <th scope="col" className="receipt__amount">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {(receipt.items ?? []).map((item) => (
              <tr key={item.id ?? `${item.name}-${item.variantName ?? ''}`}>
                <td>
                  {item.name}
                  {item.variantName ? <span className="muted"> · {item.variantName}</span> : null}
                  <span className="receipt__unit muted"> @ {formatPaise(item.unitPricePaise)}</span>
                </td>
                <td className="receipt__qty numeric">{item.quantity}</td>
                <td className="receipt__amount numeric">{formatPaise(item.lineTotalPaise)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <TotalRow label="Subtotal">{formatPaise(receipt.totals.subtotalPaise)}</TotalRow>
            {receipt.totals.discountPaise > 0 ? (
              <TotalRow label="Discount">−{formatPaise(receipt.totals.discountPaise)}</TotalRow>
            ) : null}
            {receipt.totals.deliveryFeePaise > 0 ? (
              <TotalRow label="Delivery">{formatPaise(receipt.totals.deliveryFeePaise)}</TotalRow>
            ) : null}
            {receipt.totals.taxPaise > 0 ? (
              <TotalRow label="Tax">{formatPaise(receipt.totals.taxPaise)}</TotalRow>
            ) : null}
            <TotalRow label="Total" strong>
              {formatPaise(receipt.totals.totalPaise)}
            </TotalRow>
          </tfoot>
        </table>

        <section className="receipt__block">
          <h3>{receipt.fulfilment?.mode === 'delivery' ? 'Delivered to' : 'Collected from'}</h3>
          {target ? (
            <address className="address__lines">
              <span>{target.recipientName ?? target.name}</span>
              {[target.line1, target.addressLine1, target.line2, target.addressLine2]
                .filter(Boolean)
                .map((line) => (
                  <span key={line}>{line}</span>
                ))}
              <span>{[target.city, target.state, target.postalCode].filter(Boolean).join(', ')}</span>
            </address>
          ) : null}
        </section>

        {receipt.payment ? (
          <section className="receipt__block">
            <h3>Payment</h3>
            <p>
              {receipt.payment.method === 'online' ? 'Paid online' : 'Cash on collection or delivery'}
              {receipt.payment.status ? ` · ${receipt.payment.status}` : null}
            </p>
          </section>
        ) : null}

        {receipt.customerNote ? (
          <section className="receipt__block">
            <h3>Note</h3>
            <p>{receipt.customerNote}</p>
          </section>
        ) : null}

        <footer className="receipt__foot muted">
          <p>Prices include tax. Keep this for your records.</p>
        </footer>
      </article>
    </div>
  );
}

function TotalRow({ label, children, strong }) {
  return (
    <tr className={strong ? 'receipt__total' : undefined}>
      <th scope="row" colSpan={2}>
        {label}
      </th>
      <td className="receipt__amount numeric">{children}</td>
    </tr>
  );
}

function ReceiptSkeleton() {
  return (
    <LoadingBlock label="Loading the receipt">
      <div className="stack">
        <Skeleton width="30%" height="1.5rem" />
        <Skeleton height="20rem" radius="var(--radius-lg)" />
      </div>
    </LoadingBlock>
  );
}
