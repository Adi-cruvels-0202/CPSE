import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="stack" style={{ textAlign: 'center', paddingTop: 'var(--space-10)' }}>
      <h1>Page not found</h1>
      <p className="muted">That link does not go anywhere in this app.</p>
      <Link to="/" className="btn" style={{ alignSelf: 'center' }}>
        Back to shop
      </Link>
    </div>
  );
}
