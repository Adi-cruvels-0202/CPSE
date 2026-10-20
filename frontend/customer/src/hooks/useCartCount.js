import { useEffect, useState } from 'react';
import { endpoints } from '../lib/endpoints.js';
import { readActiveStore } from '../lib/activeStore.js';
import { onCartChange } from '../lib/cartSignal.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * How many items are in the cart the Cart tab opens — the shop the customer
 * is shopping in (lib/activeStore.js). Units, not lines: two packets of rice
 * and one of dal is 3, as the cart page's "Subtotal (3 items)" says.
 *
 * Re-read whenever a request changes a cart (lib/cartSignal.js), on moving to
 * another shop, and on returning to the tab; no polling, because only this
 * customer's own actions change their cart.
 */
export function useCartCount() {
  const { isSignedIn } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isSignedIn) {
      setCount(0);
      return undefined;
    }

    let cancelled = false;
    let latest = 0;

    const read = async () => {
      const store = readActiveStore();
      if (!store) {
        if (!cancelled) setCount(0);
        return;
      }
      const ticket = ++latest;
      try {
        const { data } = await endpoints.cart.get(store.id);
        const lines = data?.cart?.lines ?? [];
        // A slower, older read must not overwrite a newer one.
        if (!cancelled && ticket === latest) setCount(lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0));
      } catch {
        // A badge is not worth an error message. Keep the last known figure.
      }
    };

    read();
    const stop = onCartChange(read);
    const onVisible = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isSignedIn]);

  return count;
}
