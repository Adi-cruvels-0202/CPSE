import { useRef, useState } from 'react';
import { Sheet } from '../../components/Sheet.jsx';
import './StoreLocation.css';

/**
 * Where the shop is — checklist 11.4, moved out of the last card on the page.
 *
 * It used to be a section at the very bottom: past the catalogue, past ordering,
 * past the week's hours. That is the wrong place for it. Someone deciding
 * whether to order from a neighbourhood shop asks "where is this?" before they
 * ask anything else, and the answer was four scrolls away.
 *
 * So it sits under the shop name as one tappable line — the address row every
 * delivery app puts there — and the detail lives in a sheet. That split is the
 * point: the header stays a header, and the things you might actually do with
 * an address — navigate, call, copy it into a message — are one tap away
 * instead of being three buttons nobody reads.
 */
export function StoreLocation({ store }) {
  const { contact, location, name } = store;

  const address = [
    location?.addressLine1,
    location?.addressLine2,
    location?.city,
    location?.state,
    location?.postalCode,
  ]
    .filter(Boolean)
    .join(', ');

  // Coordinates are exact; an address string is a guess the map has to parse.
  // Prefer the first, fall back to the second, offer nothing if we have neither.
  const mapHref =
    location?.latitude && location?.longitude
      ? `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`
      : address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
        : null;

  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);

  // Nothing to show and nothing to do with it.
  if (!address && !mapHref && !contact?.phone) return null;

  // The row shows the part that answers "is this near me" — the street and the
  // locality. The rest of it is in the sheet.
  const summary =
    [location?.addressLine1, location?.city].filter(Boolean).join(', ') || 'See where they are';

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="store-loc__row"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <PinIcon />
        <span className="store-loc__summary">{summary}</span>
        <span className="store-loc__cta" aria-hidden="true">
          Directions
        </span>
        <ChevronRight />
      </button>

      {open ? (
        <Sheet
          title="Where to find them"
          onClose={() => {
            setOpen(false);
            // Back where they were, not back to the top of the document.
            triggerRef.current?.focus();
          }}
        >
          <LocationBody name={name} address={address} mapHref={mapHref} phone={contact?.phone} />
        </Sheet>
      ) : null}
    </>
  );
}

function LocationBody({ name, address, mapHref, phone }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      // Long enough to read, short enough that it is gone next time.
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // A browser that refuses the clipboard is not an error worth a banner —
      // the address is on screen and can be selected.
    }
  };

  return (
    <>
      <p className="store-loc__name">{name}</p>
      {address ? <p className="store-loc__address">{address}</p> : null}

      <div className="store-loc__actions">
        {mapHref ? (
          <a className="btn btn--block" href={mapHref} target="_blank" rel="noreferrer noopener">
            <NavIcon />
            Open in Maps
          </a>
        ) : null}

        <div className="store-loc__secondary">
          {phone ? (
            <a className="btn btn--secondary" href={`tel:${phone}`}>
              <PhoneIcon />
              Call the shop
            </a>
          ) : null}

          {address ? (
            <button type="button" className="btn btn--secondary" onClick={copy}>
              <CopyIcon />
              {copied ? 'Copied' : 'Copy address'}
            </button>
          ) : null}
        </div>
      </div>

      {/* Announced rather than shown alone: the label change above is a visual
          cue, and a screen reader gets no event from it. */}
      <p className="sr-only" role="status">
        {copied ? 'Address copied.' : ''}
      </p>
    </>
  );
}

/* ── Icons ──────────────────────────────────────────────────────────────── */

const iconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

function PinIcon() {
  return (
    <svg {...iconProps} className="store-loc__pin">
      <path d="M12 21s-6.5-5.5-6.5-10a6.5 6.5 0 0 1 13 0c0 4.5-6.5 10-6.5 10Z" />
      <circle cx="12" cy="11" r="2.25" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg {...iconProps} width={16} height={16} className="store-loc__chevron">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function NavIcon() {
  return (
    <svg {...iconProps}>
      <path d="M21 3 3 10.5l7.5 3L13.5 21 21 3Z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 4h3.5l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2 4 1.5V18a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4 6.2 2 2 0 0 1 5 4Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg {...iconProps}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a1 1 0 0 1 1-1h9" />
    </svg>
  );
}
