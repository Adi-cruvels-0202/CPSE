import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { ApiError } from '../../lib/api.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatPaise } from '../../lib/money.js';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import { FormError } from '../../components/FormError.jsx';
import { CartLine } from './CartLine.jsx';
import { CartIssues } from './CartIssues.jsx';
import './CartPage.css';

/**
 * The cart — checklist 11.7.
 *
 * Store-scoped, because the cart is: one active cart per customer per store, so
 * the store id is in the path and a customer shopping at two shops has two carts
 * that cannot contaminate each other.
 *
 * **Every number on this screen comes from the server.** The cart stores no
 * prices and reprices on every read (backend D25), so a subtotal added up here
 * would be a second opinion — and the one that disagrees with the bill. Each
 * mutation replaces the whole cart with what the server returns rather than
 * patching a line in place.
 */
export function CartPage() {
  const { storeId } = useParams();
  const navigate = useNavigate();

  const { data, loading, error, refetch, setData } = useApiQuery(
    () => endpoints.cart.get(storeId),
    [storeId],
  );

  const cartData = data?.cart ?? null;

  /**
   * Fetched only for `minOrderPaise`.
   *
   * The cart's own `isCheckoutReady` means "lines exist and none of them has an
   * issue"; the minimum-order rule lives in the checkout quote, which is the
   * single gate every order passes. That is the right place for the rule — but it
   * left this screen with a Checkout button that walks into a wall, so the
   * shortfall is shown here where the customer can still act on it.
   *
   * It stays a warning rather than disabling the button: the quote is the
   * authority, and re-implementing its rules client-side is how the two start
   * disagreeing.
   */
  const store = useApiQuery(
    () => endpoints.stores.get(cartData.storeSlug),
    [cartData?.storeSlug],
    { enabled: Boolean(cartData?.storeSlug) },
  );

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [driftFound, setDriftFound] = useState(false);

  const cart = cartData;

  /**
   * Runs a mutation and adopts whatever cart comes back.
   *
   * The endpoints return the updated cart, so there is no second round trip and
   * no window where the screen shows a total the server would not agree with.
   */
  const mutate = useCallback(
    async (action) => {
      if (busy) return;
      setBusy(true);
      setActionError(null);
      setDriftFound(false);

      try {
        const result = await action();
        if (result?.data?.cart) setData({ cart: result.data.cart });
        else await refetch();
      } catch (caught) {
        setActionError(caught);
        // The cart on screen may now be wrong in a way we cannot infer — a line
        // that vanished, a price that moved — so ask the server what it is.
        if (caught instanceof ApiError && !caught.isTransient) await refetch();
      } finally {
        setBusy(false);
      }
    },
    [busy, refetch, setData],
  );

  const changeQuantity = (line, quantity) => {
    // The stepper cannot reach zero, but a removal is a DELETE either way.
    if (quantity < 1) return mutate(() => endpoints.cart.removeItem(line.id));
    return mutate(() => endpoints.cart.updateItem(line.id, { quantity }));
  };

  const remove = (line) => mutate(() => endpoints.cart.removeItem(line.id));

  const clear = () => mutate(() => endpoints.cart.clear(storeId));

  /**
   * Checklist 11.7's "validation surfacing", and the point of the whole screen.
   *
   * The prices on screen are from whenever the cart was last fetched. Before
   * going to checkout, the client tells the server exactly what it is displaying
   * and asks whether that still holds. If anything moved, the customer sees it
   * and decides — they are never carried through to checkout on a number they
   * have not seen (backend D31).
   */
  const goToCheckout = async () => {
    if (busy || !cart) return;
    setBusy(true);
    setActionError(null);

    try {
      const { data: validated } = await endpoints.cart.validate({
        storeId,
        items: cart.lines.map((line) => ({
          itemId: line.id,
          unitPricePaise: line.unitPricePaise,
        })),
      });

      const fresh = validated.cart;
      setData({ cart: fresh });

      const hasIssues =
        (fresh.issues?.length ?? 0) > 0 ||
        fresh.lines.some((line) => (line.issues?.length ?? 0) > 0);

      if (hasIssues || !fresh.isCheckoutReady) {
        // Stay put and show what changed. A second tap, now that they have seen
        // it, goes through.
        setDriftFound(true);
        return;
      }

      navigate(`/checkout/${storeId}`);
    } catch (caught) {
      setActionError(caught);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <CartSkeleton />;

  if (error && !cart) {
    return <ErrorState error={error} onRetry={refetch} title="Could not load your cart" />;
  }

  if (!cart || cart.lines.length === 0) {
    return (
      <EmptyState
        title="Your cart is empty"
        body="Add something from the shop and it will show up here."
        actionTo={cart?.storeSlug ? `/store/${cart.storeSlug}` : '/'}
        actionLabel={cart?.storeName ? `Back to ${cart.storeName}` : 'Find a shop'}
      />
    );
  }

  return (
    <div className="cart">
      <header className="cart__head">
        <h1>Your cart</h1>
        <p className="muted">{cart.storeName}</p>
      </header>

      <FormError error={actionError} />
      <CartIssues issues={cart.issues} />

      {driftFound ? (
        <p className="notice notice--warning" role="status">
          Something changed since you last looked. Check the items below, then tap Checkout again.
        </p>
      ) : null}

      <Shortfall
        minOrderPaise={store.data?.store?.fulfilment?.minOrderPaise}
        subtotalPaise={cart.totals?.subtotalPaise}
      />

      <ul className="cart__lines" aria-busy={busy || undefined}>
        {cart.lines.map((line) => (
          <CartLine
            key={line.id}
            line={line}
            storeSlug={cart.storeSlug}
            onChangeQuantity={changeQuantity}
            onRemove={remove}
            busy={busy}
          />
        ))}
      </ul>

      <Totals totals={cart.totals} />

      <div className="cart__actions">
        <button
          type="button"
          className="btn btn--block"
          onClick={goToCheckout}
          disabled={busy || !cart.isCheckoutReady}
        >
          {busy ? 'Checking…' : 'Checkout'}
        </button>

        {!cart.isCheckoutReady ? (
          <p className="muted cart__blocked">
            Sort the items above out first — checkout is not available yet.
          </p>
        ) : null}

        <div className="cart__secondary">
          {cart.storeSlug ? (
            <Link to={`/store/${cart.storeSlug}`} className="btn btn--secondary">
              Keep shopping
            </Link>
          ) : null}
          <button type="button" className="btn btn--ghost" onClick={clear} disabled={busy}>
            Empty cart
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * How much more is needed to reach the shop's minimum.
 *
 * Silent when there is no minimum or it is already met — a satisfied rule is not
 * news.
 */
function Shortfall({ minOrderPaise, subtotalPaise }) {
  if (!minOrderPaise || subtotalPaise === undefined || subtotalPaise >= minOrderPaise) return null;

  return (
    <p className="notice notice--warning" role="status">
      Add <strong className="numeric">{formatPaise(minOrderPaise - subtotalPaise)}</strong> more to
      reach this shop's {formatPaise(minOrderPaise)} minimum order.
    </p>
  );
}

/**
 * The breakdown, exactly as the server sends it.
 *
 * Tax is always 0 because catalogue prices are tax-inclusive (backend D27), so
 * the row is hidden rather than showing a meaningless ₹0.00 — but delivery at ₹0
 * is a real fact and says "Free".
 */
function Totals({ totals }) {
  if (!totals) return null;

  return (
    <section className="card cart__totals" aria-labelledby="totals-heading">
      <h2 id="totals-heading" className="cart__totals-title">
        Summary
      </h2>

      <dl>
        <Row label={`Subtotal (${totals.totalQuantity} item${totals.totalQuantity === 1 ? '' : 's'})`}>
          {formatPaise(totals.subtotalPaise)}
        </Row>

        {totals.discountPaise > 0 ? (
          <Row label="Discount" tone="good">
            −{formatPaise(totals.discountPaise)}
          </Row>
        ) : null}

        {totals.deliveryFeePaise > 0 ? (
          <Row label="Delivery">{formatPaise(totals.deliveryFeePaise)}</Row>
        ) : null}

        {totals.taxPaise > 0 ? <Row label="Tax">{formatPaise(totals.taxPaise)}</Row> : null}

        <Row label="Total" strong>
          {formatPaise(totals.totalPaise)}
        </Row>
      </dl>

      {totals.deliveryFeePaise === 0 ? (
        <p className="field__hint">
          Delivery is worked out at checkout, once you choose pickup or delivery.
        </p>
      ) : null}
    </section>
  );
}

function Row({ label, children, strong, tone }) {
  return (
    <div className={`cart__row${strong ? ' cart__row--total' : ''}`}>
      <dt>{label}</dt>
      <dd className={`numeric${tone === 'good' ? ' cart__good' : ''}`}>{children}</dd>
    </div>
  );
}

function CartSkeleton() {
  return (
    <LoadingBlock label="Loading your cart">
      <div className="stack">
        <Skeleton width="40%" height="1.5rem" />
        {[0, 1].map((key) => (
          <div key={key} className="row" style={{ gap: 'var(--space-3)' }}>
            <Skeleton width="4.5rem" height="4.5rem" radius="var(--radius-md)" />
            <div className="stack" style={{ flex: 1, gap: 'var(--space-2)' }}>
              <Skeleton width="60%" height="1rem" />
              <Skeleton width="30%" height="0.875rem" />
            </div>
          </div>
        ))}
        <Skeleton height="8rem" radius="var(--radius-lg)" />
        <Skeleton height="3rem" radius="var(--radius-md)" />
      </div>
    </LoadingBlock>
  );
}
