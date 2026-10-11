import { useState } from 'react';
import { Link } from 'react-router-dom';
import { endpoints } from '../lib/endpoints.js';
import { formatPaise } from '../lib/money.js';
import { formatWhen } from '../lib/orderStatus.js';
import './engage/Engage.css';

/**
 * Offers from shops near the customer (roadmap §5 P4 "location-based offer
 * banner"). Location is asked for only when the customer taps — never on page
 * load — and is sent once, rounded to about a kilometre, never stored.
 */
const round = (value) => Math.round(value * 100) / 100;

export function NearbyOffers() {
  const [state, setState] = useState({ status: 'idle', offers: [], message: null });

  const find = () => {
    if (!navigator.geolocation) {
      setState({ status: 'error', offers: [], message: 'This browser cannot share a location.' });
      return;
    }
    setState({ status: 'locating', offers: [], message: null });
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { data } = await endpoints.offers.nearby(round(position.coords.latitude), round(position.coords.longitude));
          setState({ status: 'done', offers: data.offers ?? [], message: null });
        } catch (caught) {
          setState({ status: 'error', offers: [], message: caught?.message ?? 'Offers could not be loaded.' });
        }
      },
      () => setState({ status: 'error', offers: [], message: 'Location was not shared, so nearby offers cannot be shown.' }),
      { maximumAge: 600_000, timeout: 10_000 },
    );
  };

  return (
    <section className="home__section stack" aria-labelledby="nearby-heading" style={{ gap: 'var(--space-2)' }}>
      <h2 id="nearby-heading" className="home__section-title">Offers near you</h2>
      {state.status === 'idle' ? (
        <button type="button" className="btn btn--secondary btn--sm" onClick={find}>Show offers near me</button>
      ) : state.status === 'locating' ? (
        <p className="muted">Finding offers near you…</p>
      ) : state.status === 'error' ? (
        <p className="notice notice--warning">{state.message}</p>
      ) : state.offers.length === 0 ? (
        <p className="muted">No offers near you right now.</p>
      ) : (
        <div className="offer-strip">
          {state.offers.map((offer) => (
            <Link key={offer.id} to={`/store/${offer.store.slug}/product/${offer.productId}`} className="offer-card" style={{ color: 'inherit', textDecoration: 'none' }}>
              <strong>{offer.title}</strong>
              <span>{offer.productName} · {offer.store.name}</span>
              <span>
                <strong className="numeric">{formatPaise(offer.offerPricePaise)}</strong>
                {offer.listPricePaise ? <s className="muted" style={{ marginLeft: 6 }}>{formatPaise(offer.listPricePaise)}</s> : null}
              </span>
              <span className="muted">{offer.distanceKm} km away · until {formatWhen(offer.endsAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
