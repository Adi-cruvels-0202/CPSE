import React, { createContext, useContext, useState, type ReactNode } from 'react';

interface StoreContextType {
  activeStoreId: string | null;
  setActiveStoreId: (id: string | null) => void;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [activeStoreId, setActiveStoreId] = useState<string | null>(() => {
    return localStorage.getItem('shopflow_active_store');
  });

  const handleSetActiveStoreId = (id: string | null) => {
    setActiveStoreId(id);
    if (id) {
      localStorage.setItem('shopflow_active_store', id);
    } else {
      localStorage.removeItem('shopflow_active_store');
    }
  };

  return (
    <StoreContext.Provider value={{ activeStoreId, setActiveStoreId: handleSetActiveStoreId }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useActiveStore() {
  const context = useContext(StoreContext);
  if (context === undefined) {
    throw new Error('useActiveStore must be used within a StoreProvider');
  }
  return context;
}
