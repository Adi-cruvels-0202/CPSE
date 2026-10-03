import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi, merchantApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import type { Merchant, StoreSummary } from '../api/types';
import { readSession, writeSession, clearSession, onSessionChange } from '../lib/session';

/**
 * Who is signed in, and whether they are a merchant (MERGE_MAPPING D-2).
 *
 * One login for both apps, so there are four states, not two:
 *
 *   loading     — a session exists and /merchant/me is being asked;
 *   signedOut   — no session;
 *   needsOnboarding — signed in, but the account is only a customer so far
 *                 (/merchant/me says 403 MERCHANT_REQUIRED). The app offers
 *                 "set up my shop" rather than an error;
 *   merchant    — signed in as a merchant;
 *   unavailable — signed in, but /merchant/me failed for another reason
 *                 (offline, rate-limited, server down) before we ever knew
 *                 the stores. The app offers "try again" — never "create a
 *                 store", which an empty store list would otherwise mean.
 */

type Status = 'loading' | 'signedOut' | 'needsOnboarding' | 'merchant' | 'unavailable';

interface AuthContextType {
  status: Status;
  merchant: Merchant | null;
  stores: StoreSummary[];
  login: (email: string, password: string) => Promise<void>;
  register: (input: { fullName: string; email: string; password: string; phone?: string }) => Promise<{ confirmEmail: boolean }>;
  onboard: (input: { fullName?: string; phone?: string }) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>(() => (readSession() ? 'loading' : 'signedOut'));
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [stores, setStores] = useState<StoreSummary[]>([]);

  const refresh = useCallback(async () => {
    if (!readSession()) {
      setStatus('signedOut');
      setMerchant(null);
      setStores([]);
      return;
    }
    try {
      const me = await merchantApi.me();
      setMerchant(me.merchant);
      setStores(me.stores);
      setStatus('merchant');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'MERCHANT_REQUIRED') {
        setMerchant(null);
        setStores([]);
        setStatus('needsOnboarding');
      } else if (error instanceof ApiError && error.status === 401) {
        clearSession();
        setStatus('signedOut');
      } else {
        // Stay signed in. A merchant already loaded keeps their stores; one
        // never loaded must not look like a merchant with none.
        setStatus((current) => (current === 'merchant' ? current : 'unavailable'));
        throw error;
      }
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
    // Signing in or out in the customer app (another tab) applies here too.
    return onSessionChange(() => {
      queryClient.clear();
      refresh().catch(() => undefined);
    });
  }, [refresh, queryClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { session } = await authApi.login({ email, password });
      writeSession(session);
      await refresh();
    },
    [refresh],
  );

  const register = useCallback(
    async (input: { fullName: string; email: string; password: string; phone?: string }) => {
      const result = await merchantApi.register(input);
      if (!result.session) return { confirmEmail: true };
      writeSession(result.session);
      await refresh();
      return { confirmEmail: false };
    },
    [refresh],
  );

  const onboard = useCallback(
    async (input: { fullName?: string; phone?: string }) => {
      await merchantApi.onboard(input);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Signing out locally is what matters; a dead token is already signed out.
    }
    clearSession();
    queryClient.clear();
    setMerchant(null);
    setStores([]);
    setStatus('signedOut');
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ status, merchant, stores, login, register, onboard, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
