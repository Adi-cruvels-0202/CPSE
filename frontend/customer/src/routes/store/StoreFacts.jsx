import { useRef, useState } from 'react';
import { formatPaiseShort } from '../../lib/money.js';
import { describeStatus, weekSchedule } from '../../lib/storeHours.js';
import { Sheet } from '../../components/Sheet.jsx';
import './StoreFacts.css';

/**
 * The two questions a shopper asks before browsing — "is it open, and will they
 * bring it to me?" — as a strip of chips under the shop name.
 *
 * Both used to be cards at the foot of the page, below the whole catalogue.
 * Nobody scrolls past a hundred products to find out there is a ₹199 minimum;
 * they find out at checkout, which is the worst possible moment. So the answers
 * that change a decision are on the chip itself — today's window, the ways to
 * get it, the minimum — and the full week and the fee breakdown are one tap
 * away in a sheet, the way a delivery app does it.
 *
 * The strip scrolls sideways rather than wrapping: a wrapped row of chips
 * reflows the whole header every time a shop has one more fact than another.
 */
export function StoreFacts({ store, description }) {
  const { fulfilment, hours } = store;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);

  const week = weekSchedule(hours);
  const today = week.find((day) => day.isToday);

  const modes = [
    fulfilment?.pickupEnabled ? 'Pickup' : null,
    fulfilment?.deliveryEnabled ? 'Delivery' : null,
  ].filter(Boolean);
  const modeLabel = modes.length > 0 ? modes.join(' or ') : 'Not taking orders';
  const orderSummary = fulfilment
    ? [modeLabel, fulfilment.deliveryEnabled
      ? fulfilment.deliveryFeePaise > 0 ? `${formatPaiseShort(fulfilment.deliveryFeePaise)} delivery` : 'Free delivery'
      : null]
      .filter(Boolean)
      .join(' · ')
    : null;
  const summary = [today?.text, orderSummary].filter(Boolean).join(' · ') || 'View shop details';

  if (!hours && !fulfilment && !description) return null;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="store-facts__summary"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="store-facts__icon"><ClockIcon /></span>
        <span className="store-facts__copy">
          <strong>Hours & ordering</strong>
          <span className="sr-only">{summary}</span>
        </span>
      </button>

      <Sheet
        open={open}
        title="Hours & ordering"
        returnFocusTarget={triggerRef.current}
        onClose={() => setOpen(false)}
      >
        <div className="stack" style={{ gap: 'var(--space-4)' }}>
          {hours ? <HoursBody hours={hours} week={week} /> : null}
          {fulfilment ? <OrderingBody fulfilment={fulfilment} modeLabel={modeLabel} /> : null}
          {description ? <p className="store-facts__description">{description}</p> : null}
        </div>
      </Sheet>
    </>
  );
}

/** The whole week at once. It is seven lines — hiding them behind a toggle
    inside a sheet the customer already chose to open would be one tap too many. */
function HoursBody({ hours, week }) {
  const status = describeStatus(hours);

  return (
    <>
      <p className={`store-facts__status${status.isOpen ? ' store-facts__status--open' : ''}`}>
        <span className="store-facts__dot" aria-hidden="true" />
        <strong>{status.label}</strong>
        {status.detail ? <span className="muted"> · {status.detail}</span> : null}
      </p>

      <dl className="store-facts__week">
        {week.map((day) => (
          <div key={day.key} className={day.isToday ? 'store-facts__week-row--today' : undefined}>
            <dt>
              {day.name}
              {day.isToday ? <span className="sr-only"> (today)</span> : null}
            </dt>
            <dd className="numeric">{day.text}</dd>
          </div>
        ))}
      </dl>

      {hours?.timezone ? (
        <p className="field__hint">All times are the shop's local time ({hours.timezone}).</p>
      ) : null}
    </>
  );
}

/** What the shop will and will not do, and the floor an order has to clear. */
function OrderingBody({ fulfilment, modeLabel }) {
  return (
    <dl className="store-facts__list">
      <div>
        <dt>Ways to get it</dt>
        <dd>{modeLabel}</dd>
      </div>

      {fulfilment.minOrderPaise > 0 ? (
        <div>
          <dt>Minimum order</dt>
          <dd className="numeric">{formatPaiseShort(fulfilment.minOrderPaise)}</dd>
        </div>
      ) : null}

      {fulfilment.deliveryEnabled ? (
        <div>
          <dt>Delivery fee</dt>
          <dd className="numeric">
            {fulfilment.deliveryFeePaise > 0
              ? formatPaiseShort(fulfilment.deliveryFeePaise)
              : 'Free'}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/* ── Icons ──────────────────────────────────────────────────────────────── */

const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

function ClockIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  );
}
