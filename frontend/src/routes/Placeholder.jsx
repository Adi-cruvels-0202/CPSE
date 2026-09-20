import { Link } from 'react-router-dom';

/**
 * A screen that is routed but not yet built.
 *
 * Every Phase 11 item has a route from the start, so navigation can be wired and
 * walked end to end before the screens exist (checklist 11.18). This states
 * plainly which checklist item fills it in — an honest empty room rather than a
 * "coming soon" that says nothing.
 */
export function Placeholder({ title, item, children }) {
  return (
    <div className="stack">
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <h1>{title}</h1>
        <p className="muted">Not built yet — checklist {item}.</p>
      </div>

      {children}

      <Link to="/" className="btn btn--secondary" style={{ alignSelf: 'flex-start' }}>
        Back to shop
      </Link>
    </div>
  );
}
