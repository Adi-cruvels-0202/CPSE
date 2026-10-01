/**
 * Where the Supabase access/refresh pair lives.
 *
 * The API returns Supabase's own tokens rather than setting a session cookie
 * (backend decision D18), so the browser has to keep them somewhere. That is a
 * choice with a real trade-off, so it is made here, in one place:
 *
 *   localStorage — survives a reload and a closed tab, which is what a shopper
 *   returning to a cart expects. Readable by any script running on this origin,
 *   so an XSS bug becomes a stolen session.
 *
 *   An httpOnly cookie would resist that, but the backend does not issue one,
 *   and inventing a parallel session in the frontend is exactly the separate
 *   auth system the spec rules out.
 *
 * So: localStorage, and the mitigation is not storing it somewhere cleverer but
 * not having an XSS bug — no `dangerouslySetInnerHTML`, no injected script tags,
 * everything rendered as text by React.
 *
 * Every access goes through try/catch: Safari's private mode and a blocked
 * third-party-storage setting both make localStorage throw rather than return
 * null, and a shop that cannot open at all is worse than one you must sign in
 * to again.
 */

const KEY = 'cpse.session';

/** Falls back to memory when the browser refuses to store anything. */
let memoryFallback = null;

function readRaw() {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return memoryFallback;
  }
}

function writeRaw(value) {
  memoryFallback = value;
  try {
    if (value === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, value);
  } catch {
    // Kept in memory for this tab only. Nothing else to do.
  }
}

/**
 * The stored session, or null. A stored value that will not parse is treated as
 * absent and cleared, rather than thrown — a corrupt entry must not brick the
 * app on every load.
 */
export function readSession() {
  const raw = readRaw();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.accessToken || !parsed?.refreshToken) {
      clearSession();
      return null;
    }
    return parsed;
  } catch {
    clearSession();
    return null;
  }
}

/**
 * Stores the pair. `expiresAt` is kept when the server sends it, so the client
 * can refresh before a request fails rather than after — but it is never
 * trusted as proof of validity: only the server decides that.
 */
export function writeSession(session) {
  if (!session?.accessToken || !session?.refreshToken) {
    clearSession();
    return null;
  }

  const stored = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt ?? null,
  };

  writeRaw(JSON.stringify(stored));
  notify(stored);
  return stored;
}

export function clearSession() {
  writeRaw(null);
  notify(null);
}

/**
 * Lets the auth context react to a session change made anywhere — including one
 * made by the refresh interceptor deep inside a request, which has no other way
 * to tell React that the user is now signed out.
 */
const listeners = new Set();

export function onSessionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(session) {
  for (const listener of listeners) listener(session);
}

/** Exposed for tests, which need a clean slate between cases. */
export function resetForTests() {
  memoryFallback = null;
  listeners.clear();
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

export const SESSION_KEY = KEY;
