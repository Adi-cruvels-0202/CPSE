import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { endpoints } from '../lib/endpoints.js';
import './SaveStoreButton.css';

/**
 * The heart on a store page — checklist 9.1 from the client side.
 *
 * `isSaved` is three-valued on purpose: `null` means nobody is signed in, so
 * this button cannot know and must not guess. Tapping it then sends the customer
 * to sign in, remembering where they were, rather than failing with a 401 they
 * did not ask for.
 *
 * The toggle is optimistic. Both verbs are idempotent on the backend, so the
 * worst case of a lost request is a heart that snaps back — and waiting for a
 * round trip to fill in a heart makes a fast shop feel slow.
 */
export function SaveStoreButton({ storeId, storeSlug, isSaved, onChange }) {
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(isSaved === true);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (!isSignedIn) {
      navigate('/login', { state: { from: `/store/${storeSlug}` } });
      return;
    }
    if (busy) return;

    const next = !saved;
    setSaved(next);
    setBusy(true);

    try {
      if (next) await endpoints.stores.save(storeId);
      else await endpoints.stores.unsave(storeId);
      onChange?.(next);
    } catch {
      // Put it back. Not announced: a heart that did not stick is visible, and
      // an error banner over a favourite is more interruption than it is worth.
      setSaved(!next);
    } finally {
      setBusy(false);
    }
  };

  const label = !isSignedIn
    ? 'Save this store — sign in first'
    : saved
      ? 'Saved. Tap to remove'
      : 'Save this store';

  return (
    <button
      type="button"
      className={`save-store${saved ? ' save-store--on' : ''}`}
      onClick={toggle}
      aria-pressed={isSignedIn ? saved : undefined}
      aria-label={label}
      title={label}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill={saved ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M12 20s-7-4.4-7-9.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.8C19 15.6 12 20 12 20Z" />
      </svg>
    </button>
  );
}
