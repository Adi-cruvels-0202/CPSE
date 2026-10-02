import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './useAuth';

/**
 * Which of the merchant's stores every screen is working on.
 *
 * Remembered in localStorage per browser, and checked against the stores the
 * merchant actually owns: a remembered id for a store they no longer own (or a
 * different person signed in) falls back to their newest store.
 */

interface StoreContextType {
  activeStoreId: string | null;
  setActiveStoreId: (id: string | null) => void;
}

const KEY = 'cpse.merchant.activeStore';
const StoreContext = createContext<StoreContextType | undefined>(undefined);

function remembered(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { stores, status } = useAuth();
  const [chosen, setChosen] = useState<string | null>(remembered);

  const setActiveStoreId = (id: string | null) => {
    setChosen(id);
    try {
      if (id) window.localStorage.setItem(KEY, id);
      else window.localStorage.removeItem(KEY);
    } catch {
      // Not remembered across reloads; fine for this tab.
    }
  };

  // Only ever one of the merchant's own stores.
  const owned = stores.some((store) => store.id === chosen);
  const activeStoreId = owned ? chosen : stores[0]?.id ?? null;

  useEffect(() => {
    if (status === 'merchant' && activeStoreId !== chosen) setActiveStoreId(activeStoreId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, activeStoreId]);

  return <StoreContext.Provider value={{ activeStoreId, setActiveStoreId }}>{children}</StoreContext.Provider>;
}

export function useActiveStore() {
  const context = useContext(StoreContext);
  if (context === undefined) throw new Error('useActiveStore must be used within a StoreProvider');
  return context;
}
