import { formatWhen } from '../../lib/orderStatus.js';

/**
 * Where the order has got to — checklist 11.10.
 *
 * The server sends `steps`, which is the path this *particular* order takes: a
 * pickup order never shows "out for delivery" and a delivery order never shows
 * "ready for pickup". Rendering the whole enum would show every customer two
 * steps that can never happen to them.
 *
 * A cancelled or rejected order has no path left, so its steps are replaced by
 * what actually happened.
 */
export function OrderTimeline({ timeline, status }) {
  const steps = timeline?.steps ?? [];

  if (status === 'cancelled' || status === 'rejected') {
    return <History history={timeline?.history} />;
  }

  return (
    <ol className="timeline">
      {steps.map((step) => {
        const reached = Boolean(step.reachedAt);

        return (
          <li
            key={step.status}
            className={`timeline__step${reached ? ' timeline__step--reached' : ''}${
              step.isCurrent ? ' timeline__step--current' : ''
            }`}
            aria-current={step.isCurrent ? 'step' : undefined}
          >
            <span className="timeline__marker" aria-hidden="true">
              {reached ? <Tick /> : null}
            </span>
            <span className="timeline__body">
              <span className="timeline__label">{step.label}</span>
              {step.reachedAt ? (
                <span className="timeline__when">{formatWhen(step.reachedAt)}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** What actually happened, for an order that did not follow the path. */
function History({ history }) {
  if (!history || history.length === 0) return null;

  return (
    <ol className="timeline">
      {history.map((entry, index) => (
        <li
          key={`${entry.toStatus}-${index}`}
          className="timeline__step timeline__step--reached"
        >
          <span className="timeline__marker" aria-hidden="true">
            <Tick />
          </span>
          <span className="timeline__body">
            <span className="timeline__label">{entry.label ?? entry.toStatus}</span>
            {entry.note ? <span className="timeline__note">{entry.note}</span> : null}
            {entry.at || entry.changedAt ? (
              <span className="timeline__when">{formatWhen(entry.at ?? entry.changedAt)}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Tick() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
