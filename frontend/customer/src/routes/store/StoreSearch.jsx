import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { useDebounced } from '../../hooks/useDebounced.js';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import { ProductCard } from './ProductCard.jsx';
import './StoreSearch.css';

/**
 * Store-scoped search — checklist 11.6.
 *
 * Scoped is the point: this searches one shop's catalogue, never across shops.
 * Network-wide discovery is explicitly out of scope, and a search box that
 * quietly widened would be a different product.
 *
 * Public, like the rest of the storefront. The query lives in the URL so a
 * search can be shared and the back button returns to the previous one.
 *
 * The two-character floor is the server's rule (a one-character query matches
 * most of a catalogue and turns search into an export). The screen respects it
 * by not asking at all below two, rather than showing the customer a 422.
 */
const MIN_QUERY = 2;

export function StoreSearch() {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const urlQuery = searchParams.get('q') ?? '';
  const [typed, setTyped] = useState(urlQuery);
  const query = useDebounced(typed.trim(), 300);

  // The URL follows the settled query, not every keystroke, so the history is
  // one entry per search rather than one per letter.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (query) next.set('q', query);
    else next.delete('q');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- following `query` only
  }, [query]);

  const enabled = query.length >= MIN_QUERY;

  const { data, meta, loading, error, refetch } = useApiQuery(
    () => endpoints.stores.search(slug, { q: query, limit: 20 }),
    [slug, query],
    { enabled },
  );

  return (
    <div className="search">
      <div className="search__bar">
        <Link to={`/store/${slug}`} className="search__back" aria-label="Back to the shop">
          <ChevronLeft />
        </Link>

        <label className="sr-only" htmlFor="store-search">
          Search this shop
        </label>
        <input
          id="store-search"
          type="search"
          className="search__input"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Search this shop"
          autoComplete="off"
          enterKeyHint="search"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the entire screen
          // is this one input; anything else would need a tap to begin.
          autoFocus
        />

        {typed ? (
          <button
            type="button"
            className="search__clear"
            onClick={() => setTyped('')}
            aria-label="Clear the search"
          >
            ×
          </button>
        ) : null}
      </div>

      <Results
        slug={slug}
        query={query}
        typed={typed}
        enabled={enabled}
        data={data}
        meta={meta}
        loading={loading}
        error={error}
        onRetry={refetch}
      />
    </div>
  );
}

function Results({ slug, query, typed, enabled, data, meta, loading, error, onRetry }) {
  if (!enabled) {
    return (
      <p className="search__hint muted">
        {typed.trim().length === 0
          ? 'Type to search this shop’s products.'
          : `Keep going — ${MIN_QUERY} characters minimum.`}
      </p>
    );
  }

  if (loading) {
    return (
      <LoadingBlock label={`Searching for ${query}`}>
        <ul className="catalogue__grid">
          {[0, 1, 2, 3].map((key) => (
            <li key={key}>
              <div className="product-card">
                <Skeleton height="0" style={{ aspectRatio: '1 / 1', height: 'auto' }} />
                <div className="product-card__body">
                  <Skeleton width="80%" height="0.875rem" />
                  <Skeleton width="45%" height="1rem" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </LoadingBlock>
    );
  }

  if (error) return <ErrorState error={error} onRetry={onRetry} title="Could not search" />;

  const products = data?.products ?? [];

  if (products.length === 0) {
    return (
      <EmptyState
        title={`Nothing here matches “${query}”`}
        body="Try a shorter word, or a different spelling."
        actionTo={`/store/${slug}`}
        actionLabel="Browse the whole shop"
      />
    );
  }

  return (
    <>
      {/* Announced, so a screen reader hears the count change instead of having
          to go looking for it. */}
      <p className="search__count muted" role="status">
        {meta?.total === 1 ? '1 match' : `${meta?.total ?? products.length} matches`} for “{query}”
      </p>

      <ul className="catalogue__grid">
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} storeSlug={slug} />
          </li>
        ))}
      </ul>
    </>
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
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}
