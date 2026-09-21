import { useEffect, useState } from 'react';

/**
 * Whether the browser thinks it has a connection — checklist 11.16.
 *
 * `navigator.onLine` is famously optimistic: it says true for a device on a wifi
 * network with no route to the internet. So this is a *hint*, not a source of
 * truth, and nothing in the app is gated on it. A request still goes out, and a
 * genuine failure still surfaces as `NETWORK_ERROR` from the API client.
 *
 * What it buys is the one thing a failed request cannot say by itself: that the
 * problem is the customer's connection and not this shop, before they have tapped
 * anything. Hence a banner, not a blocked screen.
 */
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
