import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet } from '../../components/Sheet.jsx';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatPaise } from '../../lib/money.js';
import { formatWhen } from '../../lib/orderStatus.js';
import { StoreConsent } from '../engage/PreferencesPage.jsx';
import '../engage/Engage.css';
import './StoreExtras.css';

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
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
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
    <>
      <button
        ref={triggerRef}
        type="button"
        className="store-connect__trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="store-connect__icon"><ActionsIcon /></span>
        <span className="store-connect__trigger-copy">Shop actions</span>
      </button>

      <Sheet
        open={open}
        title="Shop actions"
        onClose={() => setOpen(false)}
        returnFocusTarget={triggerRef.current}
      >
        <div className="stack store-connect__sheet-content">
          <div className="store-connect__grid">
            <Link to={isSignedIn ? ask : '/login'} state={isSignedIn ? undefined : { from: ask }} className="store-connect__action">
              <span className="store-connect__icon"><MessageIcon /></span>
              <span>Ask the shop</span>
            </Link>
            <button type="button" className="store-connect__action" onClick={share}>
              <span className="store-connect__icon"><ShareIcon /></span>
              <span>Share shop</span>
            </button>
            <a className="store-connect__action" href={`https://wa.me/?text=${encodeURIComponent(`Order from ${store.name}: ${url}`)}`} target="_blank" rel="noreferrer">
              <span className="store-connect__icon"><MessageIcon /></span>
              <span>Share on WhatsApp</span>
            </a>
            {isSignedIn ? (
              <>
                <Link to={`/points/${store.id}`} className="store-connect__action">
                  <span className="store-connect__icon"><PointsIcon /></span>
                  <span>My points here</span>
                </Link>
                <button type="button" className="store-connect__action" onClick={() => setShowConsent((v) => !v)} aria-expanded={showConsent}>
                  <span className="store-connect__icon"><BellIcon /></span>
                  <span>{showConsent ? 'Hide shop updates' : 'Shop updates I receive'}</span>
                </button>
              </>
            ) : null}
          </div>
          {shared ? <p className="store-connect__status" role="status">{shared}</p> : null}
          {showConsent ? <ConsentPanel store={store} /> : null}
        </div>
      </Sheet>
    </>
  );
}

const actionIconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

function MessageIcon() {
  return <svg {...actionIconProps}><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.6-3.1A7.5 7.5 0 1 1 20 11.5Z" /><path d="M8.5 11.5h.01M12.5 11.5h.01M16.5 11.5h.01" /></svg>;
}

function ShareIcon() {
  return <svg {...actionIconProps}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.7 10.5 6.6-4M8.7 13.5l6.6 4" /></svg>;
}

function PointsIcon() {
  return <svg {...actionIconProps}><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg>;
}

function BellIcon() {
  return <svg {...actionIconProps}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></svg>;
}

function ActionsIcon() {
  return <svg {...actionIconProps}><path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v5H4zM14 15h6v5h-6z" /></svg>;
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
