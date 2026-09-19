import { supabaseAdmin } from '../../lib/supabase.js';
import { internal } from '../../lib/errors.js';
import { STORE_COLUMNS, findActiveStoreById, toPublicStore } from '../stores/store.service.js';

/**
 * Saved stores — "my stores" — checklist 9.1 – 9.2.
 *
 * The table is a pure join with a composite primary key, so saving twice is a
 * no-op by construction: the upsert below cannot create a duplicate row, and
 * unsaving something that was never saved is not an error either. Both verbs
 * are idempotent, which is what a heart button that can be double-tapped needs.
 */

const fail = (error, message) => {
  if (error) throw internal(message);
};

/**
 * Checklist 9.1. A store that does not exist, or is inactive, is a 404 — the
 * same answer the storefront gives, so a save cannot be used to probe for
 * stores that are hidden from browsing.
 */
export async function saveStore(customerId, storeId) {
  // Throws 404 for an unknown or inactive store.
  const store = await findActiveStoreById(storeId);

  const { error } = await supabaseAdmin
    .from('saved_stores')
    .upsert(
      { customer_id: customerId, store_id: storeId },
      { onConflict: 'customer_id,store_id', ignoreDuplicates: true },
    );

  fail(error, 'Could not save the store.');
  return { store: toPublicStore(store, { isSaved: true }) };
}

/**
 * Checklist 9.1. Idempotent: unsaving a store that is not saved succeeds. The
 * store row is still checked, so an unknown id is a 404 rather than a silent
 * success that tells the client nothing.
 */
export async function unsaveStore(customerId, storeId) {
  const store = await findActiveStoreById(storeId);

  const { error } = await supabaseAdmin
    .from('saved_stores')
    .delete()
    .eq('customer_id', customerId)
    .eq('store_id', storeId);

  fail(error, 'Could not remove the store.');
  return { store: toPublicStore(store, { isSaved: false }) };
}

/**
 * Checklist 9.2. Newest save first, and each entry carries enough to open the
 * store directly — the slug for the link, plus the name, logo and open/closed
 * state a list row shows. That is the whole point of the screen: tap and go.
 *
 * A store that has since been deactivated is dropped from the list rather than
 * shown as a dead link. The save itself is kept, so it reappears if the store
 * comes back.
 */
export async function listSavedStores(customerId, { page = 1, limit = 20 } = {}) {
  const from = (page - 1) * limit;

  const { data, count, error } = await supabaseAdmin
    .from('saved_stores')
    .select('store_id, created_at', { count: 'exact' })
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  fail(error, 'Could not load your saved stores.');

  const rows = data ?? [];
  if (rows.length === 0) return { savedStores: [], total: count ?? 0 };

  const { data: stores, error: storeError } = await supabaseAdmin
    .from('stores')
    .select(STORE_COLUMNS)
    .in('id', rows.map((row) => row.store_id))
    .eq('is_active', true);

  fail(storeError, 'Could not load your saved stores.');

  const byId = new Map((stores ?? []).map((store) => [store.id, store]));

  const savedStores = rows
    .filter((row) => byId.has(row.store_id))
    .map((row) => ({
      savedAt: row.created_at,
      store: toPublicStore(byId.get(row.store_id), { isSaved: true }),
    }));

  return { savedStores, total: count ?? rows.length };
}
