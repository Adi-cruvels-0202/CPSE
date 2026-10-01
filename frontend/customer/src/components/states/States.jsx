import { Link } from 'react-router-dom';
import './States.css';

/**
 * The screens a screen shows when it has no content — checklist 11.16.
 *
 * Three distinct situations, and collapsing them is what makes an app
 * confusing: nothing is here yet, something broke, or we cannot reach the
 * server. A customer can act on the third, should retry the second, and needs
 * neither for the first.
 */

/** A grey block standing in for content that is on its way. */
export function Skeleton({ width = '100%', height = '1rem', radius, style }) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ display: 'block', width, height, borderRadius: radius, ...style }}
    />
  );
}

/**
 * Wraps a screen's skeleton so a screen reader is told something is happening
 * rather than being read an empty page.
 */
export function LoadingBlock({ label = 'Loading', children }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

/**
 * A failure the customer can do something about.
 *
 * The message comes from the server where there is one, because it is written
 * for the customer. A lost connection is called out separately: "try again" is
 * useless advice if the problem is that the phone is in a lift.
 */
export function ErrorState({ error, onRetry, title }) {
  const offline = error?.code === 'NETWORK_ERROR';
  const notFound = error?.status === 404;

  return (
    <div className="state" role="alert">
      <div className="state__icon state__icon--danger" aria-hidden="true">
        {offline ? <OfflineMark /> : <AlertMark />}
      </div>

      {/* A lost connection outranks any caller-supplied title: "No connection"
          plus "check your internet" is actionable, where "Could not load the
          products" leaves the customer tapping Try again on a dead line. */}
      <h2 className="state__title">
        {offline ? 'No connection' : (title ?? (notFound ? 'Not found' : 'Something went wrong'))}
      </h2>

      <p className="state__body">
        {offline
          ? 'Check your internet connection and try again.'
          : (error?.message ?? 'Please try again in a moment.')}
      </p>

      {onRetry ? (
        <button type="button" className="btn btn--secondary" onClick={onRetry}>
          Try again
        </button>
      ) : null}

      {error?.requestId && !offline ? (
        <p className="state__meta">
          Reference: <code>{error.requestId}</code>
        </p>
      ) : null}
    </div>
  );
}

/** Nothing here — and, where there is one, the thing to do about it. */
export function EmptyState({ title, body, actionTo, actionLabel, children }) {
  return (
    <div className="state">
      <div className="state__icon" aria-hidden="true">
        <BoxMark />
      </div>
      <h2 className="state__title">{title}</h2>
      {body ? <p className="state__body">{body}</p> : null}
      {actionTo ? (
        <Link to={actionTo} className="btn">
          {actionLabel}
        </Link>
      ) : null}
      {children}
    </div>
  );
}

const markProps = {
  width: 28,
  height: 28,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

function AlertMark() {
  return (
    <svg {...markProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5v.01" />
    </svg>
  );
}

function OfflineMark() {
  return (
    <svg {...markProps}>
      <path d="M3 3l18 18" />
      <path d="M8.5 15.5a5 5 0 0 1 7 0" />
      <path d="M5 12a10 10 0 0 1 3-2.2" />
      <path d="M16 9.8A10 10 0 0 1 19 12" />
      <path d="M12 19v.01" />
    </svg>
  );
}

function BoxMark() {
  return (
    <svg {...markProps}>
      <path d="M3 8l9-4 9 4v8l-9 4-9-4V8Z" />
      <path d="M3 8l9 4 9-4M12 12v8" />
    </svg>
  );
}
