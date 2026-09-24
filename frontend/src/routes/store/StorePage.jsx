import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { rememberStore } from '../../lib/activeStore.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { describeStatus } from '../../lib/storeHours.js';
import { RemoteImage } from '../../components/RemoteImage.jsx';
import { SaveStoreButton } from '../../components/SaveStoreButton.jsx';
import { ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import { Catalogue } from './Catalogue.jsx';
import { StoreFacts } from './StoreFacts.jsx';
import { StoreLocation } from './StoreLocation.jsx';
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

  // The category filter and page live in the URL, so a filtered view can be
  // shared and the back button behaves the way a customer expects.
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryId = searchParams.get('category');
  const page = Number(searchParams.get('page') ?? 1) || 1;

  const setCategory = (id) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('category', id);
    else next.delete('category');
    // Changing the filter starts again at the first page.
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const setPage = (value) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(value));
    setSearchParams(next, { replace: true });
  };

  // Refetched when the session changes: `isSaved` is null for an anonymous
  // visitor and a boolean once signed in, so the page personalises on return
  // from the login screen instead of showing a dead heart.
  const { data, loading, error, refetch, setData } = useApiQuery(
    () => endpoints.stores.get(slug),
    [slug, isSignedIn],
  );

  // The Cart tab has to answer "which cart?", and this is the shop they are in.
  useEffect(() => {
    if (data?.store) rememberStore(data.store);
  }, [data?.store]);

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

      <Catalogue
        storeSlug={slug}
        categoryId={categoryId}
        page={page}
        onCategoryChange={setCategory}
        onPageChange={setPage}
      />

    </article>
  );
}

function StoreHeader({ store, status, onSaveChange }) {
  return (
    <header className="store__header">
      {/*
        The back link and the heart sit ON the cover, which is where a shop page
        puts them and, more to the point, where they cannot collide with anything.
        They used to live in the row below, which is pulled up over the cover so the
        logo overlaps it — and the heart came up with it and landed on the image.
      */}
      <div className="store__banner">
        <RemoteImage
          src={store.coverImageUrl}
          name={store.name}
          alt=""
          ratio="16 / 9"
          className="store__cover"
        />

        <Link to="/" className="store__back" aria-label="Back to shops">
          <ChevronLeft />
        </Link>

        <div className="store__save">
          <SaveStoreButton
            storeId={store.id}
            storeSlug={store.slug}
            isSaved={store.isSaved}
            onChange={onSaveChange}
          />
        </div>
      </div>

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
      </div>

      {/* Under the name, where a delivery app puts it — not in a card below the
          catalogue and the week's hours, which is where it used to be. */}
      <StoreLocation store={store} />

      {/* Ordering and opening hours, in the header rather than in two cards
          below the whole catalogue — nobody scrolls past a hundred products to
          discover there is a minimum order. */}
      <StoreFacts store={store} />

      {store.description ? <p className="store__description">{store.description}</p> : null}
    </header>
  );
}

function ChevronLeft() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
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
