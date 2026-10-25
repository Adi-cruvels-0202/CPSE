import { useEffect, useState } from 'react';
import { endpoints } from '../lib/endpoints.js';
import { readActiveStore } from '../lib/activeStore.js';
import { useAuth } from '../context/AuthContext.jsx';

/** The live number of units in the customer's currently active store cart. */
export function useCartCount(routeStoreId = null) {
  const { isSignedIn } = useAuth();
  const [storeId, setStoreId] = useState(() => readActiveStore()?.id ?? null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const syncStore = () => setStoreId(readActiveStore()?.id ?? null);
    window.addEventListener('cpse:active-store-changed', syncStore);
    return () => window.removeEventListener('cpse:active-store-changed', syncStore);
  }, []);

  const activeStoreId = routeStoreId ?? storeId;

  useEffect(() => {
    if (!isSignedIn || !activeStoreId) {
      setCount(0);
      return undefined;
    }

    let currentRequest = 0;
    let mounted = true;
    const refresh = async () => {
      const requestId = ++currentRequest;
      try {
        const { data } = await endpoints.cart.get(activeStoreId);
        if (!mounted || requestId !== currentRequest) return;
        const cart = data?.cart;
        setCount(cart?.totalQuantity ?? (cart?.lines ?? []).reduce((sum, line) => sum + line.quantity, 0));
      } catch {
        // Keep the last known count; the badge should never interrupt shopping.
      }
    };

    setCount(0);
    refresh();
    window.addEventListener('cpse:cart-updated', refresh);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      mounted = false;
      window.removeEventListener('cpse:cart-updated', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isSignedIn, activeStoreId]);

  return count;
}
