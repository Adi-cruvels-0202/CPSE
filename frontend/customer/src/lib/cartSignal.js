/**
 * "The cart just changed" — so the item count on the Cart tab follows every
 * screen that adds, removes or orders, without each screen knowing the tab
 * exists. A module-level set, like `refreshUnreadCount` for the bell.
 *
 * Fired by the API client after a successful request that changes a cart (see
 * CART_CHANGING in api.js) and when the customer moves to another shop.
 */
const listeners = new Set();

export function refreshCartCount() {
  for (const listener of listeners) listener();
}

export function onCartChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
