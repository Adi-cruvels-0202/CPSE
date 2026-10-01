import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import { ProductCard } from './ProductCard.jsx';
import './Catalogue.css';

/**
 * Categories and the product grid, on the store page — checklist 11.5.
 *
 * The category filter is a URL parameter, not component state, so a filtered
 * view can be shared, bookmarked and backed out of. Same for the page number.
 *
 * Pagination is "load more" rather than numbered pages: on a phone, a grid of
 * groceries is scrolled, and numbered pages ask the customer to remember where
 * they were. The pages themselves come from the backend, capped at 100.
 */
export function Catalogue({ storeSlug, categoryId, page, onCategoryChange, onPageChange }) {
  const categories = useApiQuery(() => endpoints.stores.categories(storeSlug), [storeSlug]);

  const products = useApiQuery(
    () => endpoints.stores.products(storeSlug, { categoryId, page, limit: 12 }),
    [storeSlug, categoryId, page],
  );

  return (
    <section className="catalogue" aria-labelledby="catalogue-heading">
      <h2 id="catalogue-heading" className="catalogue__heading">
        {categoryName(categories.data, categoryId) ?? 'Everything in the shop'}
      </h2>

      <CategoryFilter
        categories={categories.data?.categories}
        loading={categories.loading}
        selected={categoryId}
        onChange={onCategoryChange}
      />

      <ProductGrid
        state={products}
        storeSlug={storeSlug}
        filtered={Boolean(categoryId)}
        onClearFilter={() => onCategoryChange(null)}
        onPageChange={onPageChange}
        page={page}
      />
    </section>
  );
}

const categoryName = (data, categoryId) =>
  categoryId ? data?.categories?.find((category) => category.id === categoryId)?.name : null;

/**
 * A horizontally scrolling row of chips. `role="tablist"` would over-promise —
 * these are filters that change the grid below, not tabs that swap panels, and
 * the browser's own semantics for a group of links-to-filters is the plainer fit.
 */
function CategoryFilter({ categories, loading, selected, onChange }) {
  if (loading) {
    return (
      <div className="catalogue__filter" aria-hidden="true">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} width="6rem" height="2.25rem" radius="var(--radius-full)" />
        ))}
      </div>
    );
  }

  // One category is not a choice; showing a single chip just takes up a row.
  if (!categories || categories.length < 2) return null;

  return (
    <div className="catalogue__filter" role="group" aria-label="Filter by category">
      <FilterChip active={!selected} onClick={() => onChange(null)}>
        All
      </FilterChip>

      {categories.map((category) => (
        <FilterChip
          key={category.id}
          active={selected === category.id}
          onClick={() => onChange(category.id)}
        >
          {category.name}
        </FilterChip>
      ))}
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`chip${active ? ' chip--active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function ProductGrid({ state, storeSlug, filtered, onClearFilter, onPageChange, page }) {
  const { data, meta, loading, refreshing, error, refetch } = state;

  if (loading) return <GridSkeleton />;

  if (error && !data) {
    return <ErrorState error={error} onRetry={refetch} title="Could not load the products" />;
  }

  const products = data?.products ?? [];

  if (products.length === 0) {
    return filtered ? (
      <EmptyState title="Nothing in this category yet">
        <button type="button" className="btn btn--secondary" onClick={onClearFilter}>
          Show everything
        </button>
      </EmptyState>
    ) : (
      <EmptyState
        title="This shop has not listed anything yet"
        body="Check back later, or give them a call."
      />
    );
  }

  const hasMore = meta?.hasNextPage;

  return (
    <>
      {/* A failed "load more" keeps the products already on screen and says so,
          rather than throwing the grid away. */}
      {error ? (
        <p className="notice notice--danger" role="alert">
          {error.message}
        </p>
      ) : null}

      <ul className="catalogue__grid" aria-busy={refreshing || undefined}>
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} storeSlug={storeSlug} />
          </li>
        ))}
      </ul>

      {meta ? (
        <p className="catalogue__count muted">
          Showing {products.length} of {meta.total}
        </p>
      ) : null}

      {hasMore ? (
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => onPageChange(page + 1)}
          disabled={refreshing}
        >
          {refreshing ? 'Loading…' : 'Show more'}
        </button>
      ) : null}
    </>
  );
}

function GridSkeleton() {
  return (
    <LoadingBlock label="Loading the products">
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
