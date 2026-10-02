/**
 * Where the signed-in session lives — shared with the customer app.
 *
 * Both apps are served from the same origin (the backend hosts the customer
 * app at / and this one at /merchant) and both use the same Supabase login
 * (MERGE_MAPPING D-2), so they read and write the same localStorage entry. A
 * shopkeeper signed in on one is signed in on the other; signing out of
 * either signs out of both. The key and shape match
 * frontend/customer/src/lib/tokens.js.
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

const KEY = 'cpse.session';
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

/** Called when the session changes here, or in the other app in another tab. */
export function onSessionChange(listener: (session: Session | null) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(session: Session | null) {
  for (const listener of listeners) listener(session);
}

// Another tab — this app or the customer app — signed in or out.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) notify(readSession());
  });
}
