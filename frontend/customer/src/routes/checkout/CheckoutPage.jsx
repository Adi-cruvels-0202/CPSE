import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { ApiError } from '../../lib/api.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatPaise } from '../../lib/money.js';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import { FormError } from '../../components/FormError.jsx';
import { AddressCard } from '../addresses/AddressCard.jsx';
import { AddressForm } from '../addresses/AddressForm.jsx';
import {
  FulfilmentChoice,
  PaymentChoice,
  QuoteIssues,
  Review,
  Step,
} from './CheckoutSections.jsx';
import './Checkout.css';

/**
 * Checkout — checklist 11.8.
 *
 * **The quote is the screen.** `POST /checkout/quote` prices the order, lists
 * every reason it cannot be placed, and says whether it can — and order creation
 * calls the same pricing engine, so the number shown here is the number charged.
 * Nothing on this screen re-derives any of that: `blockers` are why the button is
 * disabled, `warnings` are things to know, `canPlaceOrder` is what the button
 * binds to.
 *
 * Every change of mode or address re-quotes, because the fee and the blockers
 * depend on both.
 */
/**
 * What to offer when the shop itself could not be loaded.
 *
 * Both modes, no fee stated — the quote is the authority on both, and it refuses a
 * mode the shop does not do. Better than a screen with no choices on it.
 */
const FALLBACK_FULFILMENT = {
  pickupEnabled: true,
  deliveryEnabled: true,
  minOrderPaise: 0,
  deliveryFeePaise: 0,
};

export function CheckoutPage() {
  const { storeId } = useParams();
  const navigate = useNavigate();

  const [fulfilmentMode, setFulfilmentMode] = useState(null);
  const [addressId, setAddressId] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [addingAddress, setAddingAddress] = useState(false);
  const [placeError, setPlaceError] = useState(null);
  const [placing, setPlacing] = useState(false);

  /**
   * One key for this screen, not one per tap.
   *
   * A retry after a network timeout must present the *same* key, so the server
   * hands back the order it already created instead of placing a second one
   * (backend D10, D30). Generating it per click would defeat the whole mechanism.
   */
  const idempotencyKey = useMemo(
    () => (globalThis.crypto?.randomUUID?.() ?? `cpse-${Date.now()}-${Math.random()}`),
    [],
  );

  /**
   * The cart first, for the store's slug.
   *
   * The route carries the store's *id*, and `GET /stores/:slug` takes a slug — it
   * 404s on a uuid. The cart payload carries both, so it is the way through. It is
   * also what tells us there is anything to check out at all.
   */
  const cart = useApiQuery(() => endpoints.cart.get(storeId), [storeId]);
  const storeSlug = cart.data?.cart?.storeSlug ?? null;

  // Needed before the first quote: which fulfilment modes to even offer.
  const store = useApiQuery(() => endpoints.stores.get(storeSlug), [storeSlug], {
    enabled: Boolean(storeSlug),
  });
  const addresses = useApiQuery(() => endpoints.addresses.list(), []);
  const methods = useApiQuery(() => endpoints.payments.methods(), []);

  const fulfilment = store.data?.store?.fulfilment;

  // Default to whatever the shop offers — pickup when it does both, since it is
  // the option with no fee and no address to choose. With no store to ask, the
  // quote is still the authority: it refuses a mode the shop does not do.
  useEffect(() => {
    if (fulfilmentMode) return;
    const offered = fulfilment ?? (storeSlug && !store.error ? null : FALLBACK_FULFILMENT);
    if (!offered) return;

    if (offered.pickupEnabled) setFulfilmentMode('pickup');
    else if (offered.deliveryEnabled) setFulfilmentMode('delivery');
  }, [fulfilment, fulfilmentMode, storeSlug, store.error]);

  // The default address, once they load — the one a customer means nine times out
  // of ten.
  useEffect(() => {
    if (addressId || !addresses.data?.addresses?.length) return;
    const list = addresses.data.addresses;
    setAddressId((list.find((address) => address.isDefault) ?? list[0]).id);
  }, [addresses.data, addressId]);

  const needsAddress = fulfilmentMode === 'delivery';
  const canQuote = Boolean(fulfilmentMode) && (!needsAddress || Boolean(addressId));

  const quote = useApiQuery(
    () =>
      endpoints.checkout.quote({
        storeId,
        fulfilmentMode,
        ...(needsAddress && addressId ? { addressId } : {}),
      }),
    [storeId, fulfilmentMode, needsAddress ? addressId : null],
    { enabled: canQuote },
  );

  const quoted = quote.data?.quote ?? null;

  /**
   * Places the order.
   *
   * `expectedTotalPaise` is the total the customer is looking at. If it moved
   * between the quote and this request the server refuses outright (D31) — nobody
   * is charged a number they have not seen — and the re-quote below shows them
   * what changed.
   */
  const placeOrder = async () => {
    if (placing || !quoted?.canPlaceOrder) return;
    setPlacing(true);
    setPlaceError(null);

    try {
      const { data } = await endpoints.orders.create(
        {
          storeId,
          fulfilmentMode,
          ...(needsAddress ? { addressId } : {}),
          paymentMethod,
          ...(note.trim() ? { customerNote: note.trim() } : {}),
          expectedTotalPaise: quoted.totals.totalPaise,
        },
        idempotencyKey,
      );

      const order = data.order;

      // An online order is not placed yet: it is pending_payment until the
      // provider confirms, so the customer goes to the payment screen. A cash
      // order is placed, and goes straight to its confirmation.
      navigate(paymentMethod === 'online' ? `/payment/${order.id}` : `/orders/${order.id}`, {
        replace: true,
        state: { justPlaced: true },
      });
    } catch (caught) {
      setPlaceError(caught);
      // The quote is stale in exactly the cases that matter — a price moved, an
      // item sold out — so ask again and let the customer see it.
      if (caught instanceof ApiError && !caught.isTransient) quote.refetch();
    } finally {
      setPlacing(false);
    }
  };

  // Order matters here. Errors first, then "nothing to buy", then the wait —
  // otherwise a failed cart sits under a skeleton forever, and a cart that has not
  // arrived reads as an empty one.
  /**
   * Only the cart is essential.
   *
   * The store is fetched for the fulfilment options and the minimum — useful, not
   * load-bearing, because the quote decides both and refuses anything the shop does
   * not do. Treating its failure as fatal stopped a customer checking out over a
   * detail they never see.
   */
  if (cart.error) {
    return <ErrorState error={cart.error} onRetry={cart.refetch} title="Could not start checkout" />;
  }

  // An empty cart is not an error to report, it is a customer with nothing to buy.
  // Caught here rather than waiting for the quote's CART_EMPTY, so they are not
  // shown a checkout form for nothing.
  if ((cart.data && cart.data.cart.lines.length === 0) || quote.error?.code === 'CART_EMPTY') {
    return (
      <EmptyState
        title="Your cart is empty"
        body="Add something to it and checkout will be here."
        actionTo={storeSlug ? `/store/${storeSlug}` : '/'}
        actionLabel="Back to the shop"
      />
    );
  }

  // `store` is chained off the cart, so there is a moment where the cart has
  // arrived and the store request has not started — `store.loading` is false and
  // `store.data` is null. Gating on `loading` alone rendered the page, then blanked
  // it back to a skeleton the instant the store request began (the same flicker
  // D56 fixed for the storefront). Waiting for the data itself covers both.
  /**
   * Waits for the cart and the addresses, and for the store only while it still
   * might arrive.
   *
   * It used to wait on `!store.data` alone. The store query is chained off the
   * cart's `storeSlug`, and when that field was missing from the payload the query
   * never became enabled — so the condition was permanently true and the screen
   * span forever. A guard that can never be satisfied is worse than no guard: the
   * customer gets no error, no retry, and nothing to report.
   *
   * Now an unresolvable store costs the fulfilment choices their detail, and
   * nothing else.
   */
  const storeMightArrive = Boolean(storeSlug) && !store.data && !store.error;

  if (cart.loading || addresses.loading || storeMightArrive) return <CheckoutSkeleton />;

  return (
    <div className="checkout">
      <header className="checkout__head">
        <h1>Checkout</h1>
        <p className="muted">{cart.data?.cart?.storeName ?? store.data?.store?.name}</p>
      </header>

      <Step step={1} title="How do you want it?">
        <FulfilmentChoice
          fulfilment={fulfilment ?? FALLBACK_FULFILMENT}
          value={fulfilmentMode}
          onChange={(mode) => setFulfilmentMode(mode)}
          disabled={placing}
        />
      </Step>

      {needsAddress ? (
        <Step step={2} title="Where to?">
          <AddressPicker
            state={addresses}
            selectedId={addressId}
            onSelect={(address) => setAddressId(address.id)}
            adding={addingAddress}
            onAdd={() => setAddingAddress(true)}
            onCancelAdd={() => setAddingAddress(false)}
            onCreated={async (payload) => {
              const { data } = await endpoints.addresses.create(payload);
              await addresses.refetch();
              setAddressId(data.address.id);
              setAddingAddress(false);
            }}
            disabled={placing}
          />
        </Step>
      ) : null}

      <Step step={needsAddress ? 3 : 2} title="How do you want to pay?">
        <PaymentChoice
          methods={methods.data?.methods}
          value={paymentMethod}
          onChange={setPaymentMethod}
          disabled={placing}
        />
      </Step>

      <Step
        step={needsAddress ? 4 : 3}
        title="Anything the shop should know?"
        hint="Optional — a floor number, a preferred time, how ripe you like the bananas."
      >
        <textarea
          className="field__input checkout__note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Leave at the gate, please."
          disabled={placing}
          aria-label="Note for the shop"
        />
      </Step>

      <Step step={needsAddress ? 5 : 4} title="Check it over">
        {!canQuote ? (
          <p className="muted">Choose an address to see the total.</p>
        ) : quote.loading ? (
          <Skeleton height="10rem" radius="var(--radius-md)" />
        ) : quote.error ? (
          <ErrorState error={quote.error} onRetry={quote.refetch} title="Could not price your order" />
        ) : quoted ? (
          <>
            <QuoteIssues blockers={quoted.blockers} warnings={quoted.warnings} />
            <Review quote={quoted} />
          </>
        ) : null}
      </Step>

      <div className="checkout__place">
        <FormError error={placeError} />

        <button
          type="button"
          className="btn btn--block"
          onClick={placeOrder}
          disabled={placing || !quoted?.canPlaceOrder || quote.refreshing}
        >
          {placing ? (
            <>
              <span className="spinner spinner--on-brand" />
              Placing your order…
            </>
          ) : quoted ? (
            `Place order · ${formatPaise(quoted.totals.totalPaise)}`
          ) : (
            'Place order'
          )}
        </button>

        {paymentMethod === 'online' ? (
          <p className="field__hint">
            You will be taken to our payment partner. Your order is confirmed once they tell us the
            payment went through.
          </p>
        ) : null}

      </div>

      {/* Below the bar, not inside it: going back is a way out, not the second
          half of a pair of equal choices. */}
      <div className="checkout__back">
        <Link to={`/cart/${storeId}`} className="btn btn--ghost">
          Back to cart
        </Link>
      </div>
    </div>
  );
}

/** The address list, with a form to add one without leaving checkout. */
function AddressPicker({
  state,
  selectedId,
  onSelect,
  adding,
  onAdd,
  onCancelAdd,
  onCreated,
  disabled,
}) {
  if (state.error) {
    return (
      <ErrorState error={state.error} onRetry={state.refetch} title="Could not load your addresses" />
    );
  }

  const addresses = state.data?.addresses ?? [];

  if (adding || addresses.length === 0) {
    return (
      <div className="stack">
        {addresses.length === 0 ? (
          <p className="muted">You have no addresses saved. Add the first one here.</p>
        ) : null}
        <AddressForm
          onSave={onCreated}
          onCancel={addresses.length > 0 ? onCancelAdd : undefined}
          saveLabel="Use this address"
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="addresses">
        {addresses.map((address) => (
          <AddressCard
            key={address.id}
            address={address}
            selectable
            selected={selectedId === address.id}
            onSelect={onSelect}
            busy={disabled}
          />
        ))}
      </div>

      <button type="button" className="btn btn--secondary btn--sm" onClick={onAdd} disabled={disabled}>
        Deliver somewhere else
      </button>
    </div>
  );
}

function CheckoutSkeleton() {
  return (
    <LoadingBlock label="Getting checkout ready">
      <div className="stack">
        <Skeleton width="40%" height="1.5rem" />
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} height="5rem" radius="var(--radius-lg)" />
        ))}
        <Skeleton height="3rem" radius="var(--radius-md)" />
      </div>
    </LoadingBlock>
  );
}
