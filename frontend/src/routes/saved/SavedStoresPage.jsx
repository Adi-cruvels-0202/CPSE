import { Link, useSearchParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatPaiseShort } from '../../lib/money.js';
import { describeStatus } from '../../lib/storeHours.js';
import { RemoteImage } from '../../components/RemoteImage.jsx';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import './Saved.css';

/**
 * Saved stores — checklist 11.13.
 *
 * The point of the screen is one tap to the shop, so each row carries what
 * decides that tap: the name, whether it is open, and how it will reach you.
 * Newest save first, because the shop someone just saved is the one they are
 * about to open.
 *
 * A store that has been deactivated is already dropped by the server, so this
 * list never shows a dead link.
 */
export function SavedStoresPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get('page') ?? 1) || 1;

  const { data, meta, loading, refreshing, error, refetch } = useApiQuery(
    () => endpoints.savedStores.list({ page, limit: 20 }),
    [page],
  );

  if (loading) return <SavedSkeleton />;

  if (error && !data) {
    return <ErrorState error={error} onRetry={refetch} title="Could not load your saved stores" />;
  }

  const saved = data?.savedStores ?? [];

  if (saved.length === 0) {
    return (
      <EmptyState
        title="No saved stores yet"
        body="Tap the heart on a shop's page and it will show up here, ready to open."
        actionTo="/"
        actionLabel="Find a shop"
      />
    );
  }

  return (
    <div className="stack">
      <h1>Saved stores</h1>

      <ul className="saved" aria-busy={refreshing || undefined}>
        {saved.map((entry) => (
          <SavedRow key={entry.store.id} entry={entry} />
        ))}
      </ul>

      {meta?.hasNextPage ? (
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.set('page', String(page + 1));
            setSearchParams(next, { replace: true });
          }}
          disabled={refreshing}
        >
          {refreshing ? 'Loading…' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}

function SavedRow({ entry }) {
  const { store } = entry;
  const status = describeStatus(store.hours);
  const modes = [
    store.fulfilment?.pickupEnabled ? 'Pickup' : null,
    store.fulfilment?.deliveryEnabled ? 'Delivery' : null,
  ].filter(Boolean);

  return (
    <li>
      <Link to={`/store/${store.slug}`} className="saved-row">
        <RemoteImage
          src={store.logoUrl}
          name={store.name}
          alt=""
          ratio="1 / 1"
          className="saved-row__logo"
          rounded="var(--radius-md)"
        />

        <div className="saved-row__body">
          <span className="saved-row__name">{store.name}</span>

          <span className={`saved-row__status${status.isOpen ? ' saved-row__status--open' : ''}`}>
            <span className="store__dot" aria-hidden="true" />
            {status.label}
            {status.detail ? <span className="muted"> · {status.detail}</span> : null}
          </span>

          <span className="muted saved-row__meta">
            {modes.join(' or ') || 'Not taking orders'}
            {store.fulfilment?.minOrderPaise > 0
              ? ` · ${formatPaiseShort(store.fulfilment.minOrderPaise)} minimum`
              : null}
          </span>
        </div>

        <ChevronRight />
      </Link>
    </li>
  );
}

function ChevronRight() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="saved-row__chevron"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function SavedSkeleton() {
  return (
    <LoadingBlock label="Loading your saved stores">
      <div className="stack">
        <Skeleton width="45%" height="1.5rem" />
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} height="5rem" radius="var(--radius-lg)" />
        ))}
      </div>
    </LoadingBlock>
  );
}
