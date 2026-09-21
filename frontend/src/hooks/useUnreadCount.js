import { useEffect, useState } from 'react';
import { endpoints } from '../lib/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * The unread notification count, for the badge on the tab bar — checklist 11.14.
 *
 * Its own hook rather than part of a screen, because the badge lives in the shell
 * and must be right wherever the customer is. `/notifications/unread-count`
 * exists precisely for this: it counts without fetching the rows.
 *
 * Polled slowly and deliberately. A badge that is a minute stale costs nothing;
 * a badge that polls every few seconds for the whole session costs a request per
 * customer per few seconds, forever. It also refreshes on returning to the tab,
 * which is when someone actually looks at it.
 */
const POLL_MS = 60_000;

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

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isSignedIn]);

  return count;
}
