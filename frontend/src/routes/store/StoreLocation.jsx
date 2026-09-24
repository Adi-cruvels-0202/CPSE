import { useEffect, useRef, useState } from 'react';
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
 * delivery app puts there — and the detail lives in a bottom sheet. That split
 * is the point: the header stays a header (one line, no wall of text), and the
 * things you might actually do with an address — navigate, call, copy it into a
 * message — are one tap away instead of being three buttons nobody reads.
 *
 * The sheet is a real dialog, not a div that appears: it takes focus, traps Tab
 * while it is open, closes on Escape and on the backdrop, and hands focus back
 * to the row that opened it. A sheet that does none of that is a trap for anyone
 * not using a mouse.
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
        <LocationSheet
          name={name}
          address={address}
          mapHref={mapHref}
          phone={contact?.phone}
          onClose={() => {
            setOpen(false);
            // Back where they were, not back to the top of the document.
            triggerRef.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

function LocationSheet({ name, address, mapHref, phone, onClose }) {
  const panelRef = useRef(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const panel = panelRef.current;
    // The panel itself, not the close button and not the first action: focus has
    // to enter the dialog, but landing it on a control both draws a focus ring
    // onto something nobody chose and puts a finger on "Open in Maps". Focusing
    // the labelled dialog announces its heading and leaves Tab to the reader.
    panel?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      // Keep Tab inside the sheet: behind it is a whole page of links that a
      // sighted user cannot see and cannot reach.
      const focusable = panel?.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    // The page behind must not scroll under the sheet.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

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
    <div className="store-loc__scrim" onClick={onClose}>
      {/* The sheet swallows the click that would close it. */}
      <div
        className="store-loc__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="store-loc-heading"
        ref={panelRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {/* The grab handle every bottom sheet has: it says "this pulls down"
            before anyone has tried. Decorative — the close button is the
            control, and dragging is not a keyboard gesture. */}
        <span className="store-loc__grip" aria-hidden="true" />

        <div className="store-loc__head">
          <h2 id="store-loc-heading" className="store-loc__title">
            Where to find them
          </h2>
          <button
            type="button"
            className="store-loc__close"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <p className="store-loc__name">{name}</p>
        {address ? <p className="store-loc__address">{address}</p> : null}

        <div className="store-loc__actions">
          {mapHref ? (
            <a
              className="btn btn--block"
              href={mapHref}
              target="_blank"
              rel="noreferrer noopener"
            >
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
      </div>
    </div>
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

function CloseIcon() {
  return (
    <svg {...iconProps} width={20} height={20}>
      <path d="M6 6l12 12M18 6L6 18" />
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
