import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatPaiseShort } from '../../lib/money.js';
import { describeStatus, weekSchedule } from '../../lib/storeHours.js';
import { RemoteImage } from '../../components/RemoteImage.jsx';
import { SaveStoreButton } from '../../components/SaveStoreButton.jsx';
import { ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import './StorePage.css';

/**
 * The public storefront — checklist 11.4.
 *
 * This is the entry point the spec cares most about: a customer arrives from a
 * link or a QR code the shop shared, with no account and no session, and the
 * page has to make sense on its own. So everything here is readable without a
 * token, and the only thing that needs one — the save button — asks for it at
 * the moment it is tapped rather than gating the page.
 *
 * The open/closed line comes from the server, which resolves it in the store's
 * own timezone. A client computing it from the visitor's clock would disagree
 * with the shop, and with every other visitor in a different zone.
 */
export function StorePage() {
  const { slug } = useParams();
  const { isSignedIn } = useAuth();

  // Refetched when the session changes: `isSaved` is null for an anonymous
  // visitor and a boolean once signed in, so the page personalises on return
  // from the login screen instead of showing a dead heart.
  const { data, loading, error, refetch, setData } = useApiQuery(
    () => endpoints.stores.get(slug),
    [slug, isSignedIn],
  );

  if (loading) return <StorePageSkeleton />;

  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={error.status === 404 ? undefined : refetch}
        title={error.status === 404 ? 'That shop is not here' : undefined}
      />
    );
  }

  // A 200 without a store means the contract moved under us. That is our bug,
  // not the customer's, and it should read as a failure rather than crash the
  // whole app through the error boundary.
  if (!data?.store) {
    return <ErrorState error={{ message: 'This shop could not be loaded.' }} onRetry={refetch} />;
  }

  const store = data.store;
  const status = describeStatus(store.hours);

  return (
    <article className="store">
      <StoreHeader store={store} status={status} onSaveChange={(isSaved) =>
        setData({ store: { ...store, isSaved } })
      } />

      {!status.isOpen ? (
        <p className="notice notice--warning">
          {store.name} is closed right now. You can still order — the shop will see it when they
          open{status.detail ? `, ${status.detail.toLowerCase()}` : ''}.
        </p>
      ) : null}

      <nav className="store__actions" aria-label="Browse this store">
        <Link to={`/store/${slug}/search`} className="store__search" aria-label="Search this store">
          <SearchIcon />
          <span>Search {store.name}</span>
        </Link>
      </nav>

      <Fulfilment fulfilment={store.fulfilment} />

      <Hours hours={store.hours} />

      <Contact store={store} />
    </article>
  );
}

function StoreHeader({ store, status, onSaveChange }) {
  return (
    <header className="store__header">
      <RemoteImage
        src={store.coverImageUrl}
        name={store.name}
        alt=""
        ratio="16 / 9"
        className="store__cover"
      />

      <div className="store__identity">
        <RemoteImage
          src={store.logoUrl}
          name={store.name}
          alt={`${store.name} logo`}
          ratio="1 / 1"
          className="store__logo"
          rounded="var(--radius-lg)"
        />

        <div className="store__titles">
          <h1>{store.name}</h1>
          <p className={`store__status${status.isOpen ? ' store__status--open' : ''}`}>
            <span className="store__dot" aria-hidden="true" />
            <strong>{status.label}</strong>
            {status.detail ? <span className="muted"> · {status.detail}</span> : null}
          </p>
        </div>

        <SaveStoreButton
          storeId={store.id}
          storeSlug={store.slug}
          isSaved={store.isSaved}
          onChange={onSaveChange}
        />
      </div>

      {store.description ? <p className="store__description">{store.description}</p> : null}
    </header>
  );
}

/** What the shop will and will not do, and the floor an order has to clear. */
function Fulfilment({ fulfilment }) {
  if (!fulfilment) return null;

  const modes = [
    fulfilment.pickupEnabled ? 'Pickup' : null,
    fulfilment.deliveryEnabled ? 'Delivery' : null,
  ].filter(Boolean);

  return (
    <section className="card store__section" aria-labelledby="fulfilment-heading">
      <h2 id="fulfilment-heading" className="store__section-title">
        Ordering
      </h2>

      <dl className="store__facts">
        <div>
          <dt>Ways to get it</dt>
          <dd>{modes.length > 0 ? modes.join(' or ') : 'Not taking orders'}</dd>
        </div>

        {fulfilment.minOrderPaise > 0 ? (
          <div>
            <dt>Minimum order</dt>
            <dd className="numeric">{formatPaiseShort(fulfilment.minOrderPaise)}</dd>
          </div>
        ) : null}

        {fulfilment.deliveryEnabled ? (
          <div>
            <dt>Delivery fee</dt>
            <dd className="numeric">
              {fulfilment.deliveryFeePaise > 0
                ? formatPaiseShort(fulfilment.deliveryFeePaise)
                : 'Free'}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

/** Today's line is always visible; the rest of the week is one tap away. */
function Hours({ hours }) {
  const [expanded, setExpanded] = useState(false);
  const week = weekSchedule(hours);
  const today = week.find((day) => day.isToday);

  return (
    <section className="card store__section" aria-labelledby="hours-heading">
      <div className="spread">
        <h2 id="hours-heading" className="store__section-title">
          Opening hours
        </h2>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          {expanded ? 'Hide week' : 'Whole week'}
        </button>
      </div>

      {/* Just the window. The header already carries the "closes at" / "opens
          at" line, and saying it twice on one screen reads as a mistake. */}
      {today ? (
        <p className="store__today">
          <strong>Today</strong> · {today.text}
        </p>
      ) : null}

      {expanded ? (
        <dl className="store__week">
          {week.map((day) => (
            <div key={day.key} className={day.isToday ? 'store__week-row--today' : undefined}>
              <dt>{day.name}</dt>
              <dd className="numeric">{day.text}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {hours?.timezone ? (
        <p className="field__hint">All times are the shop's local time ({hours.timezone}).</p>
      ) : null}
    </section>
  );
}

function Contact({ store }) {
  const { contact, location } = store;
  const address = [
    location?.addressLine1,
    location?.addressLine2,
    location?.city,
    location?.state,
    location?.postalCode,
  ]
    .filter(Boolean)
    .join(', ');

  const mapHref =
    location?.latitude && location?.longitude
      ? `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`
      : address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
        : null;

  return (
    <section className="card store__section" aria-labelledby="contact-heading">
      <h2 id="contact-heading" className="store__section-title">
        Where to find them
      </h2>

      {address ? <p className="store__address">{address}</p> : null}

      <div className="store__contact-actions">
        {mapHref ? (
          <a
            className="btn btn--secondary btn--sm"
            href={mapHref}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open in Maps
          </a>
        ) : null}

        {contact?.phone ? (
          <a className="btn btn--secondary btn--sm" href={`tel:${contact.phone}`}>
            Call the shop
          </a>
        ) : null}
      </div>
    </section>
  );
}

function StorePageSkeleton() {
  return (
    <LoadingBlock label="Loading the shop">
      <div className="store">
        <Skeleton height="10rem" radius="var(--radius-lg)" />
        <div className="row" style={{ marginTop: 'var(--space-4)' }}>
          <Skeleton width="4rem" height="4rem" radius="var(--radius-lg)" />
          <div className="stack" style={{ flex: 1, gap: 'var(--space-2)' }}>
            <Skeleton width="60%" height="1.5rem" />
            <Skeleton width="40%" height="1rem" />
          </div>
        </div>
        <Skeleton height="3rem" radius="var(--radius-md)" style={{ marginTop: 'var(--space-4)' }} />
        <Skeleton height="8rem" radius="var(--radius-lg)" style={{ marginTop: 'var(--space-4)' }} />
      </div>
    </LoadingBlock>
  );
}

function SearchIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </svg>
  );
}
