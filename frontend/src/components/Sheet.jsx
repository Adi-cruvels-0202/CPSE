import { useEffect, useId, useRef } from 'react';
import './Sheet.css';

/**
 * A bottom sheet — the pattern a shopping app uses for detail that would bloat
 * a header: it rises from the thumb end on a phone, and becomes an ordinary
 * centred dialog once there is room.
 *
 * It is a real dialog, not a div that appears. Focus enters it, Tab stays
 * inside it, Escape and the backdrop close it, and focus goes back where it
 * came from. A sheet that skips those is a trap for anyone not using a mouse,
 * and there is now more than one of these on the store page — so the behaviour
 * lives here once rather than being re-derived each time.
 */
export function Sheet({ title, onClose, children }) {
  const panelRef = useRef(null);
  const headingId = useId();

  useEffect(() => {
    const panel = panelRef.current;
    // The panel itself, not a control inside it: focus has to enter the dialog,
    // but landing it on a button both draws a focus ring onto something nobody
    // chose and puts a finger on whatever the first action happens to be.
    // Focusing the labelled dialog announces its heading instead.
    panel?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      // Behind the sheet is a whole page of links a sighted keyboard user
      // cannot see and must not reach.
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

  return (
    <div className="sheet__scrim" onClick={onClose}>
      {/* The sheet swallows the click that would close it. */}
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        ref={panelRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {/* The grab handle every bottom sheet has: it says "this pulls down"
            before anyone has tried. Decorative — the close button is the
            control, and dragging is not a keyboard gesture. */}
        <span className="sheet__grip" aria-hidden="true" />

        <div className="sheet__head">
          <h2 id={headingId} className="sheet__title">
            {title}
          </h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
