import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * The landing screen. Temporary, in the sense that 11.4 onwards will replace its
 * middle with a real storefront — but the shape is right: the app has no
 * network-wide store discovery (that is explicitly out of scope), so a customer
 * arrives here either from a shared store link or from their saved stores.
 */
export function Home() {
  const { status, customer } = useAuth();

  return (
    <div className="stack">
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <h1>{status === 'signedIn' ? `Hello, ${firstName(customer)}` : 'Shop nearby'}</h1>
        <p className="muted">
          Open a store from a link your shop shared, or from the stores you have saved.
        </p>
      </div>

      <div className="card stack">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Try the seeded store</h2>
        <p className="muted">
          The backend ships with three dummy stores. This one has a catalogue, variants and
          opening hours.
        </p>
        <Link to="/store/sharma-kirana" className="btn btn--block">
          Open Sharma Kirana Store
        </Link>
      </div>

      {status === 'signedOut' ? (
        <div className="card stack">
          <h2 style={{ fontSize: 'var(--text-base)' }}>Have an account?</h2>
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
        </div>
      ) : null}
    </div>
  );
}

const firstName = (customer) => customer?.fullName?.split(' ')[0] ?? 'there';
