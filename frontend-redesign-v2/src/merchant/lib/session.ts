/**
 * Where the signed-in session lives — this app's own, not the customer app's.
 *
 * Both apps are served from the same origin (the backend hosts the customer
 * app at / and this one at /merchant), but a shop account and a customer
 * account are separate logins (MERGE_MAPPING D-2, revised). So each app keeps
 * its own localStorage entry: signing in here does not sign anyone in to the
 * customer app, and signing out of one leaves the other alone. The shape
 * matches frontend/customer/src/lib/tokens.js; the key does not.
 *
 * localStorage, with the customer app's reasoning: the API returns Supabase's
 * tokens rather than a cookie, and the defence against theft is not having an
 * XSS bug — everything here is rendered as text by React.
 */

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
}

const KEY = 'cpse.merchant.session';
let memoryFallback: string | null = null;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return memoryFallback;
  }
}

function writeRaw(value: string | null) {
  memoryFallback = value;
  try {
    if (value === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, value);
  } catch {
    // Private mode or blocked storage: kept in memory for this tab.
  }
}

export function readSession(): Session | null {
  const raw = readRaw();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.accessToken || !parsed?.refreshToken) {
      writeRaw(null);
      return null;
    }
    return parsed;
  } catch {
    writeRaw(null);
    return null;
  }
}

export function writeSession(session: { accessToken: string; refreshToken: string; expiresAt?: number | null }) {
  const stored: Session = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt ?? null,
  };
  writeRaw(JSON.stringify(stored));
  notify(stored);
}

export function clearSession() {
  writeRaw(null);
  notify(null);
}

const listeners = new Set<(session: Session | null) => void>();

/** Called when the session changes here, or in this app in another tab. */
export function onSessionChange(listener: (session: Session | null) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(session: Session | null) {
  for (const listener of listeners) listener(session);
}

// This app in another tab signed in or out.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) notify(readSession());
  });
}
