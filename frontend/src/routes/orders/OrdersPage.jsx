import { Link, useSearchParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatPaise } from '../../lib/money.js';
import { formatSince, formatWhen, isTerminal, progressFor, toneFor } from '../../lib/orderStatus.js';
import { RemoteImage } from '../../components/RemoteImage.jsx';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import './Orders.css';

/**
 * Order history — checklist 11.10.
 *
 * Newest first, which is what someone opening this screen is looking for: the
 * order they placed twenty minutes ago, not the one from March.
 *
 * The status filter lives in the URL so a filtered view is shareable and the back
 * button behaves, same as the catalogue.
 */
const FILTERS = [
  { value: null, label: 'All' },
  { value: 'placed', label: 'Placed' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function OrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status');
  const page = Number(searchParams.get('page') ?? 1) || 1;

  const { data, meta, loading, refreshing, error, refetch } = useApiQuery(
    () => endpoints.orders.list({ status, page, limit: 10 }),
    [status, page],
  );

  const setFilter = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('status', value);
    else next.delete('status');
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  if (loading) return <OrdersSkeleton />;

  if (error && !data) {
    return <ErrorState error={error} onRetry={refetch} title="Could not load your orders" />;
  }

  const orders = data?.orders ?? [];

  return (
    <div className="stack">
      <h1>Your orders</h1>

      <div className="catalogue__filter" role="group" aria-label="Filter by status">
        {FILTERS.map((filter) => (
          <button
            key={filter.label}
            type="button"
            className={`chip${status === filter.value ? ' chip--active' : ''}`}
            onClick={() => setFilter(filter.value)}
            aria-pressed={status === filter.value}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {orders.length === 0 ? (
        status ? (
          <EmptyState title={`No ${status.replace('_', ' ')} orders`}>
            <button type="button" className="btn btn--secondary" onClick={() => setFilter(null)}>
              Show all orders
            </button>
          </EmptyState>
        ) : (
          <EmptyState
            title="You have not ordered anything yet"
            body="Open a shop, fill your cart, and your orders will show up here."
            actionTo="/"
            actionLabel="Find a shop"
          />
        )
      ) : (
        <>
          {/* Live orders first and under their own heading. Someone opening this
              screen almost always wants the one that is happening right now, and
              an undivided list makes them read statuses to find it. The split is
              dropped while a status filter is on — the filter has already said
              what the customer is looking at. */}
          {split(orders, Boolean(status)).map((group) => (
            <section key={group.label ?? 'all'} className="orders__group">
              {group.label ? <h2 className="orders__heading">{group.label}</h2> : null}

              <ul className="orders" aria-busy={refreshing || undefined}>
                {group.items.map((order) => (
                  <OrderRow key={order.id} order={order} />
                ))}
              </ul>
            </section>
          ))}

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
              {refreshing ? 'Loading…' : 'Show older orders'}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * One row carries enough to decide whether to open it: which shop, when, what it
 * cost, how many things, and where it has got to.
 */
function OrderRow({ order }) {
  const progress = progressFor(order.status, order.fulfilmentMode);

  return (
    <li>
      <Link to={`/orders/${order.id}`} className="order-row">
        {/* The list payload carries no logo, so this is always the initials
            block. That is the point of it — a shop you recognise by its mark,
            in the same place on every row. */}
        <RemoteImage
          src={null}
          name={order.storeName}
          alt=""
          className="order-row__mark"
          rounded="var(--radius-md)"
        />

        <div className="order-row__body">
          <div className="order-row__top">
            <span className="order-row__store">{order.storeName}</span>
            <span className={`status status--${toneFor(order.status)}`}>{order.statusLabel}</span>
          </div>

          <div className="order-row__meta">
            <span>
              {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{order.fulfilmentMode === 'delivery' ? 'Delivery' : 'Pickup'}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={order.placedAt} title={formatWhen(order.placedAt)}>
              {formatSince(order.placedAt)}
            </time>
          </div>

          {/* Only while it is moving. On a finished order a progress track is
              decoration, and on a cancelled one it is a lie. */}
          {progress ? (
            <span
              className="order-row__track"
              style={{ '--progress': `${(progress.step / progress.total) * 100}%` }}
              aria-hidden="true"
            />
          ) : null}

          <div className="order-row__foot">
            <span className="numeric order-row__number">{order.orderNumber}</span>
            <span className="numeric order-row__total">{formatPaise(order.totalPaise)}</span>
          </div>
        </div>
      </Link>
    </li>
  );
}

/** Live orders, then finished ones — or one undivided list when filtered. */
function split(orders, filtered) {
  if (filtered) return [{ label: null, items: orders }];

  const live = orders.filter((order) => !isTerminal(order.status));
  const past = orders.filter((order) => isTerminal(order.status));

  // No heading when there is only one kind: a lone "Past orders" heading over
  // the only list on the screen is a label for nothing.
  if (live.length === 0 || past.length === 0) return [{ label: null, items: orders }];

  return [
    { label: 'Happening now', items: live },
    { label: 'Past orders', items: past },
  ];
}

function OrdersSkeleton() {
  return (
    <LoadingBlock label="Loading your orders">
      <div className="stack">
        <Skeleton width="45%" height="1.5rem" />
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} height="6rem" radius="var(--radius-lg)" />
        ))}
      </div>
    </LoadingBlock>
  );
}
