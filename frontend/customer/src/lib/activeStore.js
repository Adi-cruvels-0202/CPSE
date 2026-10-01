/**
 * The shop the customer is currently shopping in.
 *
 * The cart is store-scoped — one per customer per store — so a "Cart" tab in the
 * bottom bar has to answer "which cart?". This remembers the last shop they were
 * actually in, which is the one they mean.
 *
 * Stored rather than held in memory so it survives a reload, and wrapped in
 * try/catch for the same reason the session is: Safari's private mode throws
 * rather than returning null, and a tab that cannot be tapped is worse than one
 * that occasionally forgets.
 */
const KEY = 'cpse.activeStore';

let fallback = null;

export function rememberStore(store) {
  if (!store?.id) return;

  const value = JSON.stringify({ id: store.id, slug: store.slug ?? null, name: store.name ?? null });
  fallback = value;

  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // Kept for this tab only.
  }
}

export function readActiveStore() {
  let raw = fallback;
  try {
    raw = window.localStorage.getItem(KEY) ?? fallback;
  } catch {
    // Use the in-memory copy.
  }

  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

export function forgetStore() {
  fallback = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}
