import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { endpoints } from '../lib/endpoints.js';
import { ApiError } from '../lib/api.js';
import { clearSession, onSessionChange, readSession, writeSession } from '../lib/tokens.js';

/**
 * Who is signed in, for the whole app.
 *
 * `status` is the thing screens actually branch on, and it has three values
 * rather than a boolean, because "we do not know yet" is a real state: on the
 * first paint there is a stored token but no verified profile, and rendering a
 * signed-out header for that moment makes the app flicker for every returning
 * customer.
 *
 *   'loading'  a stored session is being checked against the server
 *   'signedIn' `customer` is populated
 *   'signedOut' no session, or the stored one was rejected
 *
 * The profile is fetched rather than decoded from the token: the token says who
 * the customer is, the server says what their profile currently holds, and only
 * one of those is up to date.
 */

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState(() => (readSession() ? 'loading' : 'signedOut'));
  const [customer, setCustomer] = useState(null);

  /** Verifies a stored session by asking for the profile it belongs to. */
  const loadProfile = useCallback(async () => {
    if (!readSession()) {
      setCustomer(null);
      setStatus('signedOut');
      return null;
    }

    try {
      const { data } = await endpoints.profile.get();
      setCustomer(data.customer);
      setStatus('signedIn');
      return data.customer;
    } catch (error) {
      // A 401 here means the stored pair is dead and the refresh already failed.
      // Anything else — offline, a 500 — is not a reason to throw the session
      // away; the customer stays signed in and the screen shows its own error.
      if (error instanceof ApiError && error.isUnauthorized) {
        clearSession();
        setCustomer(null);
        setStatus('signedOut');
        return null;
      }
      setStatus(readSession() ? 'signedIn' : 'signedOut');
      throw error;
    }
  }, []);

  useEffect(() => {
    loadProfile().catch(() => {
      // Swallowed deliberately: a failed profile load on boot is reported by
      // whichever screen needs the profile, not by a crash at the root.
    });
  }, [loadProfile]);

  /**
   * The refresh interceptor inside the API client can sign a customer out in the
   * middle of any request. This is how React finds out.
   */
  useEffect(
    () =>
      onSessionChange((session) => {
        if (!session) {
          setCustomer(null);
          setStatus('signedOut');
        }
      }),
    [],
  );

  const signIn = useCallback(async (credentials) => {
    const { data } = await endpoints.auth.login(credentials);
    writeSession(data.session);
    setCustomer(data.customer);
    setStatus('signedIn');
    return data.customer;
  }, []);

  const register = useCallback(async (details) => {
    const { data } = await endpoints.auth.register(details);

    // With email confirmation on, registering does not sign you in — the server
    // says so by returning a null session, and the screen has to tell the
    // customer to go and check their inbox.
    if (data.session) {
      writeSession(data.session);
      setCustomer(data.customer);
      setStatus('signedIn');
    }
    return data;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await endpoints.auth.logout();
    } catch {
      // The local session goes regardless. A server that cannot be reached must
      // not leave a customer stuck looking at someone else's account on a
      // shared phone.
    } finally {
      clearSession();
      setCustomer(null);
      setStatus('signedOut');
    }
  }, []);

  const value = useMemo(
    () => ({
      status,
      customer,
      isSignedIn: status === 'signedIn',
      isLoading: status === 'loading',
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
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
