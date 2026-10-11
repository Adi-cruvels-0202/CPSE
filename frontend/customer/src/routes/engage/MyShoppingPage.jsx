import { useState } from 'react';
import { Link } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatPaise } from '../../lib/money.js';
import { formatWhen } from '../../lib/orderStatus.js';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import { ProductRow } from './ProductRow.jsx';
import './Engage.css';

/**
 * Repeat shopping (roadmap §5 P2): buy again, favourites, recently viewed and a
 * short summary of the customer's own habits. All deterministic and built from
 * the customer's completed orders and the activity they allowed us to keep.
 */
const TABS = [
  { key: 'again', label: 'Buy again' },
  { key: 'favourites', label: 'Favourites' },
  { key: 'viewed', label: 'Recently viewed' },
];

export function MyShoppingPage() {
  const [tab, setTab] = useState('again');
  return (
    <div className="stack">
      <header>
        <h1>My shopping</h1>
        <p className="muted">What you buy, save and look at — so the next order is quicker.</p>
      </header>
      <Insights />
      <div className="tabs" role="tablist" aria-label="Lists">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`tabs__tab${tab === t.key ? ' tabs__tab--active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'again' ? <BuyAgain /> : tab === 'favourites' ? <Favourites /> : <RecentlyViewed />}
      <Link to="/lists" className="btn btn--secondary btn--block">Shopping lists and templates</Link>
    </div>
  );
}

function ListState({ query, empty, children }) {
  if (query.loading) {
    return (
      <LoadingBlock label="Loading">
        <div className="stack">{[0, 1, 2].map((k) => <Skeleton key={k} height="4rem" radius="var(--radius-md)" />)}</div>
      </LoadingBlock>
    );
  }
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />;
  return children ?? empty;
}

function BuyAgain() {
  const query = useApiQuery(() => endpoints.shopping.buyAgain(), []);
  const products = query.data?.products ?? [];
  return (
    <ListState query={query}>
      {products.length === 0 ? (
        <EmptyState title="Nothing to buy again yet" body="Products from your completed orders show up here, most-bought first." actionTo="/" actionLabel="Find a shop" />
      ) : (
        <ul className="prows">
          {products.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              variantId={product.usualVariantId}
              quantity={product.usualQuantity ?? 1}
              detail={`Bought ${product.timesBought} ${product.timesBought === 1 ? 'time' : 'times'} · last ${formatWhen(product.lastBoughtAt)}`}
            />
          ))}
        </ul>
      )}
    </ListState>
  );
}

function Favourites() {
  const query = useApiQuery(() => endpoints.shopping.favourites(), []);
  const products = query.data?.products ?? [];
  const remove = async (productId) => {
    await endpoints.shopping.unfavourite(productId);
    await query.refetch();
  };
  return (
    <ListState query={query}>
      {products.length === 0 ? (
        <EmptyState title="No favourites yet" body="Tap the heart on a product to keep it here." />
      ) : (
        <ul className="prows">
          {products.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              actions={
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => remove(product.id)} aria-label={`Remove ${product.name} from favourites`}>
                  Remove
                </button>
              }
            />
          ))}
        </ul>
      )}
    </ListState>
  );
}

function RecentlyViewed() {
  const query = useApiQuery(() => endpoints.shopping.recentlyViewed(), []);
  const products = query.data?.products ?? [];
  return (
    <ListState query={query}>
      {products.length === 0 ? (
        <EmptyState title="Nothing viewed recently" body="Products you open show up here — unless you turned activity off in Preferences." />
      ) : (
        <ul className="prows">
          {products.map((product) => (
            <ProductRow key={product.id} product={product} detail={`Viewed ${formatWhen(product.viewedAt)}`} />
          ))}
        </ul>
      )}
    </ListState>
  );
}

/** The customer's own numbers — never used for anything they cannot see here. */
function Insights() {
  const query = useApiQuery(() => endpoints.shopping.insights(), []);
  const insights = query.data?.insights;
  if (!insights || insights.basedOn.completedOrders === 0) return null;
  return (
    <section className="card stack" aria-labelledby="insights-heading">
      <h2 id="insights-heading" className="engage__title">Your shopping at a glance</h2>
      <dl className="engage__facts">
        <div><dt>Orders</dt><dd className="numeric">{insights.basedOn.completedOrders}</dd></div>
        <div><dt>Average order</dt><dd className="numeric">{formatPaise(insights.averageOrderPaise)}</dd></div>
        <div><dt>Per month</dt><dd className="numeric">{insights.purchaseFrequency.ordersPer30Days}</dd></div>
      </dl>
      {insights.favouriteStores?.length ? (
        <p className="muted">
          Most from: {insights.favouriteStores.slice(0, 3).map((s) => `${s.store.name ?? 'a shop'} (${s.orders})`).join(', ')}
        </p>
      ) : null}
      {insights.frequentProducts?.length ? (
        <p className="muted">Often: {insights.frequentProducts.slice(0, 5).map((p) => p.name).join(', ')}</p>
      ) : null}
    </section>
  );
}
