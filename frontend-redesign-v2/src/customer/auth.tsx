import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { endpoints } from "@/lib/cpse/endpoints";
import { ApiError } from "@/lib/cpse/api";
import { clearSession, onSessionChange, readSession, writeSession } from "@/lib/cpse/tokens";

/**
 * Customer sign-in state. Same behaviour as the original AuthContext: the
 * session pair lives in browser storage, `/me` confirms it, a SHOP_ACCOUNT or
 * 401 answer signs out. Starts in "loading" on both server and client so the
 * first render matches; the stored session is read after hydration.
 */
type Status = "loading" | "signedIn" | "signedOut";

export type Customer = {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  avatarUrl: string | null;
};

type AuthValue = {
  status: Status;
  customer: Customer | null;
  isSignedIn: boolean;
  isLoading: boolean;
  signIn: (credentials: { email: string; password: string }) => Promise<Customer>;
  register: (details: Record<string, unknown>) => Promise<any>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<Customer | null>;
  setCustomer: (customer: Customer | null) => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [customer, setCustomer] = useState<Customer | null>(null);

  const loadProfile = useCallback(async () => {
    if (!readSession()) {
      setCustomer(null);
      setStatus("signedOut");
      return null;
    }
    try {
      const { data } = await endpoints.profile.get();
      setCustomer(data.customer);
      setStatus("signedIn");
      return data.customer as Customer;
    } catch (error) {
      if (error instanceof ApiError && ((error as any).isUnauthorized || (error as any).code === "SHOP_ACCOUNT")) {
        clearSession();
        setCustomer(null);
        setStatus("signedOut");
        return null;
      }
      setStatus(readSession() ? "signedIn" : "signedOut");
      throw error;
    }
  }, []);

  useEffect(() => {
    loadProfile().catch(() => undefined);
  }, [loadProfile]);

  useEffect(() => {
    const unsubscribe = onSessionChange((session: unknown) => {
      if (!session) {
        setCustomer(null);
        setStatus("signedOut");
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (credentials: { email: string; password: string }) => {
    const { data } = await endpoints.auth.login(credentials);
    writeSession(data.session);
    setCustomer(data.customer);
    setStatus("signedIn");
    return data.customer as Customer;
  }, []);

  const register = useCallback(async (details: Record<string, unknown>) => {
    const { data } = await endpoints.auth.register(details);
    if (data.session) {
      writeSession(data.session);
      setCustomer(data.customer);
      setStatus("signedIn");
    }
    return data;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await endpoints.auth.logout();
    } catch {
      // Signing out locally is what matters; a failed revoke is not the customer's problem.
    } finally {
      clearSession();
      setCustomer(null);
      setStatus("signedOut");
    }
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      customer,
      isSignedIn: status === "signedIn",
      isLoading: status === "loading",
      signIn,
      register,
      signOut,
      refreshProfile: loadProfile,
      setCustomer,
    }),
    [status, customer, signIn, register, signOut, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>.");
  return context;
}
