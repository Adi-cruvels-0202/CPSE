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
export function StoreFacts({ store }) {
  const { fulfilment, hours } = store;

  const [openSheet, setOpenSheet] = useState(null);
  // Which chip opened it, so closing returns focus to that chip rather than to
  // the top of the strip.
  const [openedBy, setOpenedBy] = useState(null);
  const triggerRefs = useRef({});

  const week = weekSchedule(hours);
  const today = week.find((day) => day.isToday);

  const modes = [
    fulfilment?.pickupEnabled ? 'Pickup' : null,
    fulfilment?.deliveryEnabled ? 'Delivery' : null,
  ].filter(Boolean);
  const modeLabel = modes.length > 0 ? modes.join(' or ') : 'Not taking orders';

  const chips = [];

  if (today) {
    chips.push({
      key: 'hours',
      sheet: 'hours',
      icon: <ClockIcon />,
      label: today.text,
      // The chip reads "8:00 am – 9:00 pm" on its own, which says nothing about
      // *which* day or what tapping does.
      srLabel: `Opening hours. Today, ${today.text}`,
    });
  }

  if (fulfilment) {
    chips.push({
      key: 'modes',
      sheet: 'ordering',
      icon: <BagIcon />,
      label: modeLabel,
      srLabel: `Ordering. ${modeLabel}`,
    });

    if (fulfilment.minOrderPaise > 0) {
      chips.push({
        key: 'minimum',
        sheet: 'ordering',
        icon: <TagIcon />,
        label: `${formatPaiseShort(fulfilment.minOrderPaise)} minimum`,
        srLabel: `Ordering. ${formatPaiseShort(fulfilment.minOrderPaise)} minimum order`,
      });
    }

    if (fulfilment.deliveryEnabled) {
      const fee =
        fulfilment.deliveryFeePaise > 0
          ? `${formatPaiseShort(fulfilment.deliveryFeePaise)} delivery`
          : 'Free delivery';
      chips.push({ key: 'fee', sheet: 'ordering', icon: <TruckIcon />, label: fee, srLabel: `Ordering. ${fee}` });
    }
  }

  if (chips.length === 0) return null;

  const close = () => {
    setOpenSheet(null);
    triggerRefs.current[openedBy]?.focus();
  };

  return (
    <>
      <div className="store-facts" role="group" aria-label="About this shop">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            ref={(node) => {
              triggerRefs.current[chip.key] = node;
            }}
            className="store-facts__chip"
            onClick={() => {
              setOpenedBy(chip.key);
              setOpenSheet(chip.sheet);
            }}
            aria-haspopup="dialog"
            aria-label={chip.srLabel}
          >
            {chip.icon}
            <span>{chip.label}</span>
          </button>
        ))}
      </div>

      {openSheet === 'hours' ? (
        <Sheet title="Opening hours" onClose={close}>
          <HoursBody hours={hours} week={week} />
        </Sheet>
      ) : null}

      {openSheet === 'ordering' ? (
        <Sheet title="Ordering" onClose={close}>
          <OrderingBody fulfilment={fulfilment} modeLabel={modeLabel} />
        </Sheet>
      ) : null}
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

function BagIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5.5 8h13l-1 11.5a1 1 0 0 1-1 .9H7.5a1 1 0 0 1-1-.9L5.5 8Z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 12.5V5a1 1 0 0 1 1-1h7.5L20 11.5 12.5 19 4 12.5Z" />
      <circle cx="8.5" cy="8.5" r="1.2" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 7h10v9H3V7Zm10 3h4l3 3v3h-7v-6Z" />
      <circle cx="7" cy="18" r="1.5" />
      <circle cx="17" cy="18" r="1.5" />
    </svg>
  );
}
