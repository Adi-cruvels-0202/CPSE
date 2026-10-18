import { useState } from 'react';
import { Link } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatPaise } from '../../lib/money.js';
import { formatWhen } from '../../lib/orderStatus.js';
import { StoreConsent } from '../engage/PreferencesPage.jsx';
import '../engage/Engage.css';

/**
 * The parts of a shop page that come from the roadmap's relationship phases:
 * live local offers and public coupons (§5 P4), "ask the shop" (§5 P3),
 * sharing the shop (§4 P1), points at this shop and what it may send you.
 * All optional: a failed request here never stops anyone browsing.
 */

/** Offers and coupons the server says are live right now. */
export function StoreOffers({ slug }) {
  const query = useApiQuery(() => endpoints.stores.offers(slug), [slug]);
  const offers = query.data?.offers ?? [];
  const coupons = query.data?.coupons ?? [];
  if (offers.length === 0 && coupons.length === 0) return null;
  return (
    <section className="stack" aria-labelledby="offers-heading" style={{ gap: 'var(--space-2)' }}>
      <h2 id="offers-heading" className="engage__title">Offers here</h2>
      <div className="offer-strip">
        {offers.map((offer) => (
          <div key={offer.id} className="offer-card" data-testid="offer">
            <strong>{offer.title}</strong>
            <span>
              {offer.productName}
              {offer.variantName && offer.variantName !== 'Default' ? ` · ${offer.variantName}` : ''}
            </span>
            <span>
              <strong className="numeric">{formatPaise(offer.offerPricePaise)}</strong>
              {offer.listPricePaise ? <span className="muted" style={{ textDecoration: 'line-through', marginLeft: 6 }}>{formatPaise(offer.listPricePaise)}</span> : null}
            </span>
            <span className="muted">
              Until {formatWhen(offer.endsAt)}
              {offer.unitsLeft !== null ? ` · ${offer.unitsLeft} left at this price` : ''}
              {offer.batchExpiresOn ? ` · best before ${offer.batchExpiresOn}` : ''}
            </span>
            <Link to={`/store/${slug}/product/${offer.productId}`} className="btn btn--secondary btn--sm">See it</Link>
          </div>
        ))}
        {coupons.map((coupon) => (
          <div key={coupon.id ?? coupon.code} className="offer-card" data-testid="coupon">
            <strong>{coupon.title}</strong>
            <span>
              Code <strong className="numeric">{coupon.code}</strong>
            </span>
            <span className="muted">
              {coupon.minOrderPaise ? `On orders of ${formatPaise(coupon.minOrderPaise)} or more. ` : ''}
              {coupon.endsAt ? `Until ${formatWhen(coupon.endsAt)}.` : ''}
            </span>
            <span className="muted">Enter it at checkout.</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Ask, share, points and notification choices for one shop. */
export function StoreConnect({ store, isSignedIn }) {
  const [shared, setShared] = useState('');
  const [showConsent, setShowConsent] = useState(false);
  const url = `${window.location.origin}/store/${store.slug}`;
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: store.name, text: `Order from ${store.name}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared('Link copied.');
    } catch {
      // Cancelled, or clipboard blocked: the link is shown below either way.
      setShared(url);
    }
  };
  const ask = `/messages/new?storeId=${store.id}&storeName=${encodeURIComponent(store.name)}`;

  return (
    <section className="stack" aria-label="Talk to and share this shop" style={{ gap: 'var(--space-2)' }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Link to={isSignedIn ? ask : '/login'} state={isSignedIn ? undefined : { from: ask }} className="btn btn--secondary btn--sm">
          Ask the shop
        </Link>
        <button type="button" className="btn btn--secondary btn--sm" onClick={share}>Share</button>
        <a className="btn btn--secondary btn--sm" href={`https://wa.me/?text=${encodeURIComponent(`Order from ${store.name}: ${url}`)}`} target="_blank" rel="noreferrer">
          WhatsApp
        </a>
        {isSignedIn ? (
          <>
            <Link to={`/points/${store.id}`} className="btn btn--ghost btn--sm">My points here</Link>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowConsent((v) => !v)} aria-expanded={showConsent}>
              What this shop may send me
            </button>
          </>
        ) : null}
      </div>
      {shared ? <p className="muted" role="status">{shared}</p> : null}
      {showConsent ? <ConsentPanel store={store} /> : null}
    </section>
  );
}

function ConsentPanel({ store }) {
  const query = useApiQuery(() => endpoints.preferences.store(store.id), [store.id]);
  if (query.loading) return <p className="muted">Loading…</p>;
  if (query.error) return <p className="notice notice--danger">{query.error.message}</p>;
  return (
    <ul className="card prows">
      <StoreConsent compact row={{ store, ...query.data.preferences }} />
    </ul>
  );
}
