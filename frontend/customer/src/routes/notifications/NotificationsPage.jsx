import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { refreshUnreadCount } from '../../hooks/useUnreadCount.js';
import { formatDayGroup, formatSince, formatWhen } from '../../lib/orderStatus.js';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import { FormError } from '../../components/FormError.jsx';
import './Notifications.css';

/**
 * Notifications — checklist 11.14.
 *
 * Every payload carries deep-link ids only — no prices, no addresses — so each row
 * is a link to the real thing, fetched behind the customer's own token. That is
 * deliberate on the backend's side (D37), and this screen is where it pays off:
 * the list can be polled cheaply and leaks nothing if a screenshot is shared.
 *
 * Opening a notification marks it read, because that is what opening something
 * means. The badge follows from the count the server returns, never from a local
 * tally.
 */
const TYPE_ICON = {
  order_placed: 'receipt',
  order_status_changed: 'truck',
  order_cancelled: 'cross',
  payment_succeeded: 'rupee',
  payment_failed: 'cross',
  khata_updated: 'book',
};

export function NotificationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const unreadOnly = searchParams.get('unreadOnly') === 'true';
  const page = Number(searchParams.get('page') ?? 1) || 1;

  const { data, meta, loading, refreshing, error, refetch } = useApiQuery(
    () => endpoints.notifications.list({ unreadOnly, page, limit: 20 }),
    [unreadOnly, page],
  );

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const setFilter = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('unreadOnly', 'true');
    else next.delete('unreadOnly');
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const run = async (action) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await action();
      // The badge on the bell reads its own count, so it has to be told: marking
      // things read here left a red dot up there until the next poll.
      refreshUnreadCount();
      await refetch();
    } catch (caught) {
      setActionError(caught);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <NotificationsSkeleton />;

  if (error && !data) {
    return <ErrorState error={error} onRetry={refetch} title="Could not load your notifications" />;
  }

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div className="stack">
      <header className="spread">
        <h1>Notifications</h1>
        {unreadCount > 0 ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => run(() => endpoints.notifications.markAllRead())}
            disabled={busy}
          >
            Mark all read
          </button>
        ) : null}
      </header>

      <FormError error={actionError} />

      <div className="catalogue__filter" role="group" aria-label="Filter notifications">
        <button
          type="button"
          className={`chip${!unreadOnly ? ' chip--active' : ''}`}
          onClick={() => setFilter(false)}
          aria-pressed={!unreadOnly}
        >
          All
        </button>
        <button
          type="button"
          className={`chip${unreadOnly ? ' chip--active' : ''}`}
          onClick={() => setFilter(true)}
          aria-pressed={unreadOnly}
        >
          Unread{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </button>
      </div>

      {notifications.length === 0 ? (
        unreadOnly ? (
          <EmptyState title="Nothing unread" body="You are all caught up.">
            <button type="button" className="btn btn--secondary" onClick={() => setFilter(false)}>
              Show everything
            </button>
          </EmptyState>
        ) : (
          <EmptyState
            title="No notifications yet"
            body="We will tell you here when an order is accepted, on its way, or paid for."
          />
        )
      ) : (
        <>
          {/* Grouped by day, the way every feed a customer already uses is.
              An ungrouped run of rows makes "is any of this new?" a question
              about timestamps rather than something the eye answers. */}
          {groupByDay(notifications).map((group) => (
            <section key={group.label} className="notifications__group">
              <h2 className="notifications__day">{group.label}</h2>

              <ul className="notifications" aria-busy={busy || refreshing || undefined}>
                {group.items.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    onOpen={() =>
                      notification.isRead
                        ? undefined
                        : run(() => endpoints.notifications.markRead(notification.id))
                    }
                    busy={busy}
                  />
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
              {refreshing ? 'Loading…' : 'Show older'}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * A row is a link when there is something to open, and a plain item otherwise.
 *
 * `payload.order_id` is the only routing information there is, which is the whole
 * design: no notification carries the order's contents, so there is nothing to go
 * stale and nothing to leak.
 */
function NotificationRow({ notification, onOpen, busy }) {
  const orderId = notification.payload?.order_id;
  const khataId = notification.payload?.khata_account_id;
  const to = orderId ? `/orders/${orderId}` : khataId ? `/khata/${khataId}` : null;

  const body = (
    <>
      <span className={`notification__icon notification__icon--${TYPE_ICON[notification.type] ?? 'bell'}`}>
        <Mark kind={TYPE_ICON[notification.type] ?? 'bell'} />
      </span>

      <span className="notification__body">
        <span className="notification__head">
          <span className="notification__title">{headline(notification.title)}</span>
          {/* Relative in the list, exact on hover — scanning and checking are
              two different questions and only one of them is common. */}
          <time
            className="notification__when"
            dateTime={notification.createdAt}
            title={formatWhen(notification.createdAt)}
          >
            {formatSince(notification.createdAt)}
          </time>
        </span>

        {notification.body ? (
          <span className="notification__text">{notification.body}</span>
        ) : null}

        {/* The order number is reference, not headline: it is what you quote in
            a complaint, never what tells you what happened. */}
        {reference(notification.title) ? (
          <span className="notification__ref numeric">{reference(notification.title)}</span>
        ) : null}
      </span>

      {/* The dot is backed by text for a screen reader; colour alone is not a state. */}
      {notification.isRead ? null : (
        <span className="notification__unread" aria-hidden="true" />
      )}
    </>
  );

  const className = `notification${notification.isRead ? '' : ' notification--unread'}`;

  return (
    <li>
      {to ? (
        <Link to={to} className={className} onClick={onOpen} aria-disabled={busy || undefined}>
          {body}
          {notification.isRead ? null : <span className="sr-only">(unread)</span>}
        </Link>
      ) : (
        <div className={className}>
          {body}
          {notification.isRead ? null : <span className="sr-only">(unread)</span>}
        </div>
      )}
    </li>
  );
}

function Mark({ kind }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
  };

  if (kind === 'receipt') {
    return (
      <svg {...props}>
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
        <path d="M9 8h6M9 12h6" />
      </svg>
    );
  }
  if (kind === 'truck') {
    return (
      <svg {...props}>
        <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" />
        <circle cx="7" cy="18" r="1.6" />
        <circle cx="17" cy="18" r="1.6" />
      </svg>
    );
  }
  if (kind === 'cross') {
    return (
      <svg {...props}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9l6 6M15 9l-6 6" />
      </svg>
    );
  }
  if (kind === 'rupee') {
    return (
      <svg {...props}>
        <path d="M7 5h10M7 9h10M15 5c0 4-3 4-6 4l7 10" />
      </svg>
    );
  }
  if (kind === 'book') {
    return (
      <svg {...props}>
        <path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z" />
        <path d="M5 17a3 3 0 0 1 3-3h9" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <path d="M12 4a5 5 0 0 1 5 5v4l2 3H5l2-3V9a5 5 0 0 1 5-5Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

function NotificationsSkeleton() {
  return (
    <LoadingBlock label="Loading your notifications">
      <div className="stack">
        <Skeleton width="45%" height="1.5rem" />
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} height="4.5rem" radius="var(--radius-lg)" />
        ))}
      </div>
    </LoadingBlock>
  );
}

/**
 * The server writes a title as "Order CPSE-260924-WTLXBY: accepted by the store"
 * — the reference first and the news last, which is backwards for a list you
 * scan. These two pull it apart for display only; the wording itself is still
 * the server's, because it is written for the customer (backend docs/API.md)
 * and re-phrasing it here would mean two copies drifting apart.
 *
 * Anything that does not match the pattern is left exactly as it came.
 */
const TITLE_PATTERN = /^Order\s+([A-Z0-9-]+)(?::\s*|\s+)(.+)$/;

function headline(title) {
  const match = TITLE_PATTERN.exec(title ?? '');
  if (!match) return title;

  const news = match[2];
  return news.charAt(0).toUpperCase() + news.slice(1);
}

function reference(title) {
  return TITLE_PATTERN.exec(title ?? '')?.[1] ?? null;
}

/** Consecutive days, in the order the server sent them (newest first). */
function groupByDay(notifications) {
  const groups = [];

  for (const notification of notifications) {
    const label = formatDayGroup(notification.createdAt);
    const last = groups[groups.length - 1];

    if (last?.label === label) last.items.push(notification);
    else groups.push({ label, items: [notification] });
  }

  return groups;
}
