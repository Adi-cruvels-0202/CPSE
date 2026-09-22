import { Navigate } from 'react-router-dom';
import { readActiveStore } from '../../lib/activeStore.js';
import { EmptyState } from '../../components/states/States.jsx';

/**
 * What the Cart tab points at.
 *
 * A cart belongs to a shop — one per customer per store — so there is no single
 * cart to show. This resolves to the shop the customer was last in, which is the
 * cart they mean; with no shop yet, it says so rather than showing an empty cart
 * for a shop that does not exist.
 */
export function CartIndex() {
  const store = readActiveStore();

  if (store?.id) return <Navigate to={`/cart/${store.id}`} replace />;

  return (
    <EmptyState
      title="No cart yet"
      body="Open a shop and add something — your cart lives with the shop you are buying from."
      actionTo="/"
      actionLabel="Find a shop"
    />
  );
}
