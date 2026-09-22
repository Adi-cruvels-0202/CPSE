import { useEffect, useState } from 'react';
import { endpoints } from '../lib/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * The unread notification count, for the badge in the header — checklist 11.14.
 *
 * Its own hook rather than part of a screen, because the badge lives in the shell
 * and must be right wherever the customer is. `/notifications/unread-count`
 * exists precisely for this: it counts without fetching the rows.
 *
 * Polled slowly and deliberately. A badge that is a minute stale costs nothing;
 * a badge that polls every few seconds for the whole session costs a request per
 * customer per few seconds, forever. It also refreshes on returning to the tab,
 * which is when someone actually looks at it.
 *
 * Polling alone was not enough. Marking everything read emptied the list while
 * the red dot stayed on the bell for up to a minute — the customer had just told
 * us the count was zero and the badge argued with them. So the screen that
 * changes the count announces it, through `refreshUnreadCount()` below, and the
 * badge in the shell updates on the same tap.
 */
const POLL_MS = 60_000;

/**
 * Anything mounting the badge subscribes here. A module-level set, like
 * `onSessionChange` in lib/tokens.js: the publisher (the notifications screen)
 * and the subscriber (the shell) never meet, and neither needs a context.
 */
const listeners = new Set();

/**
 * Tell every badge to re-read the count now. Called after marking one or all
 * notifications read — after the request has succeeded, so what the badge reads
 * is what the server actually stored.
 */
export function refreshUnreadCount() {
  for (const listener of listeners) listener();
}

export function useUnreadCount() {
  const { isSignedIn } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isSignedIn) {
      setCount(0);
      return undefined;
    }

    let cancelled = false;

    const read = async () => {
      try {
        const { data } = await endpoints.notifications.unreadCount();
        if (!cancelled) setCount(data?.unreadCount ?? 0);
      } catch {
        // A badge is not worth an error message. Leave the last known figure.
      }
    };

    read();
    const timer = setInterval(read, POLL_MS);

    // Coming back to the tab is exactly when the number is looked at.
    const onVisible = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onVisible);

    listeners.add(read);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      listeners.delete(read);
    };
  }, [isSignedIn]);

  return count;
}
