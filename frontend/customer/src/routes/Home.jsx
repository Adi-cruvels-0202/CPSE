import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { endpoints } from '../lib/endpoints.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { formatPaise } from '../lib/money.js';
import { describeStatus } from '../lib/storeHours.js';
import { formatSince, isTerminal, meaningFor, toneFor } from '../lib/orderStatus.js';
import { RemoteImage } from '../components/RemoteImage.jsx';
import { Skeleton } from '../components/states/States.jsx';
import './Home.css';

/**
 * The landing screen.
 *
 * It used to be a greeting and a hard-coded link to the seeded store — a
 * developer's front door, not a customer's. The app has no network-wide store
 * discovery (explicitly out of scope), so a customer arrives here from a shared
 * link or from a shop they already know. That makes this screen's job narrow and
 * clear: answer "what is happening with my order" and "take me back to my shop",
 * which is exactly what the home tab of a delivery app is for.
 *
 * Both lists come from endpoints that already exist. Nothing here is new data —
 * it is the data that was three taps away being put where it is looked for.
 */
export function Home() {
  const { status, customer } = useAuth();
  const signedIn = status === 'signedIn';

  return (
    <div className="home">
      <header className="home__greeting">
        <h1>{signedIn ? `Hello, ${firstName(customer)}` : 'Shop nearby'}</h1>
        <p className="muted">
          {signedIn
            ? 'Your shops and your orders, in one place.'
            : 'Open a store from a link your shop shared, or sign in to see the ones you saved.'}
        </p>
      </header>

      {signedIn ? (
        <>
          <ActiveOrders />
          <SavedShops />
        </>
      ) : (
        <section className="card stack">
          <h2 className="home__section-title">Have an account?</h2>
          <p className="muted">
            You can browse any store without signing in. You will need an account to order.
          </p>
          <div className="row">
            <Link to="/login" className="btn">
              Sign in
            </Link>
            <Link to="/register" className="btn btn--secondary">
              Create account
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * The order that is happening right now, if there is one.
 *
 * Shown as one card rather than a list: more than one live order at a time is
 * rare, and the rest are one tap away under Orders. A quiet link is all a
 * customer with nothing in flight needs — an empty "no active orders" panel is
 * a box that exists to say nothing.
 */
function ActiveOrders() {
  const { data, loading, error } = useApiQuery(() => endpoints.orders.list({ limit: 5 }), []);

  if (loading) return <Skeleton height="6rem" radius="var(--radius-lg)" />;
  // A home screen must not lead with a failure it can do nothing about; Orders
  // reports it properly, with a retry.
  if (error) return null;

  const live = (data?.orders ?? []).filter((order) => !isTerminal(order.status));
  if (live.length === 0) return null;

  return (
    <section className="home__section" aria-labelledby="live-heading">
      <div className="spread">
        <h2 id="live-heading" className="home__section-title">
          Happening now
        </h2>
        {live.length > 1 ? (
          <Link to="/orders" className="home__more">
            All orders
          </Link>
        ) : null}
      </div>

      <Link to={`/orders/${live[0].id}`} className="home__order">
        <div className="home__order-top">
          <span className="home__order-store">{live[0].storeName}</span>
          <span className={`status status--${toneFor(live[0].status)}`}>
            {live[0].statusLabel}
          </span>
        </div>

        {/* The state's name, then what it means — the second is the one the
            customer actually wanted to know. */}
        <p className="home__order-meaning">{meaningFor(live[0].status)}</p>

        <div className="home__order-foot">
          <span>
            {live[0].itemCount} {live[0].itemCount === 1 ? 'item' : 'items'} ·{' '}
            <span className="numeric">{formatPaise(live[0].totalPaise)}</span>
          </span>
          <time dateTime={live[0].placedAt}>{formatSince(live[0].placedAt)}</time>
        </div>
      </Link>
    </section>
  );
}

/** The shops you go back to, as the tiles a home screen opens with. */
function SavedShops() {
  const { data, loading, error } = useApiQuery(() => endpoints.savedStores.list({ limit: 6 }), []);

  if (loading) return <Skeleton height="8rem" radius="var(--radius-lg)" />;
  if (error) return null;

  const saved = data?.savedStores ?? [];

  if (saved.length === 0) {
    return (
      <section className="card stack">
        <h2 className="home__section-title">No shops yet</h2>
        <p className="muted">
          Open a shop from a link and tap the heart. It will be waiting here next time.
        </p>
        <Link to="/store/sharma-kirana" className="btn btn--secondary btn--block">
          Browse a shop
        </Link>
      </section>
    );
  }

  return (
    <section className="home__section" aria-labelledby="shops-heading">
      <div className="spread">
        <h2 id="shops-heading" className="home__section-title">
          Your shops
        </h2>
        <Link to="/saved" className="home__more">
          See all
        </Link>
      </div>

      <ul className="home__shops">
        {saved.map(({ store }) => {
          const open = describeStatus(store.hours).isOpen;

          return (
            <li key={store.id}>
              <Link to={`/store/${store.slug}`} className="home__shop">
                <RemoteImage
                  src={store.logoUrl}
                  name={store.name}
                  alt=""
                  className="home__shop-mark"
                  rounded="var(--radius-md)"
                />
                <span className="home__shop-name">{store.name}</span>
                <span className={`home__shop-state${open ? ' home__shop-state--open' : ''}`}>
                  {open ? 'Open' : 'Closed'}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const firstName = (customer) => customer?.fullName?.split(' ')[0] ?? 'there';
