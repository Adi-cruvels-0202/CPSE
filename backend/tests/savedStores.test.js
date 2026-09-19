import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';
import { ALWAYS_OPEN } from './helpers/shopping.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin } = await import('../src/lib/supabase.js');
const { db, CUSTOMER_ID, STORE_ID, resetDb, seedCustomer, seedStore, seedSavedStore } =
  await import('./helpers/supabaseMock.js');

const OTHER_CUSTOMER_ID = '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e99';
const OTHER_STORE_ID = '11111111-1111-4111-8111-000000000002';
const UNKNOWN_STORE_ID = '11111111-1111-4111-8111-0000000000ff';

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  seedCustomer();
  seedCustomer({ id: OTHER_CUSTOMER_ID, email: 'other@cpse.local' });
  seedStore({ opening_hours: ALWAYS_OPEN });
  seedStore({ id: OTHER_STORE_ID, slug: 'green-leaf', name: 'Green Leaf Bakery' });
});

function signIn(id = CUSTOMER_ID) {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  return { Authorization: 'Bearer token-abc' };
}

const savedRows = () => db.tables.get('saved_stores') ?? [];
const save = (auth, storeId = STORE_ID) => api().post(url(`/stores/${storeId}/save`)).set(auth);
const unsave = (auth, storeId = STORE_ID) => api().delete(url(`/stores/${storeId}/save`)).set(auth);

describe('POST /api/v1/stores/:storeId/save (9.1)', () => {
  it('requires a signed-in customer', async () => {
    const res = await api().post(url(`/stores/${STORE_ID}/save`));

    expect(res.status).toBe(401);
  });

  it('saves the store and reports it as saved', async () => {
    const auth = signIn();

    const res = await save(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.store).toMatchObject({ id: STORE_ID, isSaved: true });
    expect(savedRows()).toHaveLength(1);
    expect(savedRows()[0]).toMatchObject({ customer_id: CUSTOMER_ID, store_id: STORE_ID });
  });

  it('is idempotent: saving twice leaves one row and still succeeds', async () => {
    const auth = signIn();

    const first = await save(auth);
    const second = await save(auth);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.store.isSaved).toBe(true);
    expect(savedRows()).toHaveLength(1);
  });

  it('404s for a store that does not exist', async () => {
    const auth = signIn();

    const res = await save(auth, UNKNOWN_STORE_ID);

    expect(res.status).toBe(404);
    expect(savedRows()).toHaveLength(0);
  });

  it('404s for an inactive store, so saving cannot probe for hidden stores', async () => {
    const auth = signIn();
    seedStore({ id: UNKNOWN_STORE_ID, slug: 'closed-down', is_active: false });

    const res = await save(auth, UNKNOWN_STORE_ID);

    expect(res.status).toBe(404);
    expect(savedRows()).toHaveLength(0);
  });

  it('422s on a store id that is not a uuid', async () => {
    const auth = signIn();

    const res = await save(auth, 'not-a-uuid');

    expect(res.status).toBe(422);
  });

  it('keeps two customers’ saves apart', async () => {
    await save(signIn());
    await save(signIn(OTHER_CUSTOMER_ID));

    expect(savedRows()).toHaveLength(2);
    expect(savedRows().map((row) => row.customer_id).sort()).toEqual(
      [CUSTOMER_ID, OTHER_CUSTOMER_ID].sort(),
    );
  });
});

describe('DELETE /api/v1/stores/:storeId/save (9.1)', () => {
  it('requires a signed-in customer', async () => {
    const res = await api().delete(url(`/stores/${STORE_ID}/save`));

    expect(res.status).toBe(401);
  });

  it('removes the save and reports it as not saved', async () => {
    const auth = signIn();
    seedSavedStore();

    const res = await unsave(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.store).toMatchObject({ id: STORE_ID, isSaved: false });
    expect(savedRows()).toHaveLength(0);
  });

  it('is idempotent: unsaving something never saved still succeeds', async () => {
    const auth = signIn();

    const res = await unsave(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.store.isSaved).toBe(false);
  });

  it('never removes another customer’s save', async () => {
    seedSavedStore({ customer_id: OTHER_CUSTOMER_ID });

    const res = await unsave(signIn());

    expect(res.status).toBe(200);
    // Ours was never there; theirs is untouched.
    expect(savedRows()).toHaveLength(1);
    expect(savedRows()[0].customer_id).toBe(OTHER_CUSTOMER_ID);
  });
});

describe('GET /api/v1/saved-stores (9.2)', () => {
  it('requires a signed-in customer', async () => {
    const res = await api().get(url('/saved-stores'));

    expect(res.status).toBe(401);
  });

  it('is empty for a customer who has saved nothing', async () => {
    const res = await api().get(url('/saved-stores')).set(signIn());

    expect(res.status).toBe(200);
    expect(res.body.data.savedStores).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it('carries enough to open the store directly (9.2)', async () => {
    const auth = signIn();
    seedSavedStore();

    const res = await api().get(url('/saved-stores')).set(auth);

    expect(res.status).toBe(200);
    const [entry] = res.body.data.savedStores;
    expect(entry.savedAt).toBeTruthy();
    expect(entry.store).toMatchObject({
      id: STORE_ID,
      slug: 'sharma-kirana',
      name: 'Sharma Kirana Store',
      isSaved: true,
    });
    // The open/closed state and fulfilment options a list row shows.
    expect(entry.store.hours).toBeDefined();
    expect(entry.store.fulfilment).toBeDefined();
  });

  it('lists the newest save first', async () => {
    const auth = signIn();
    seedSavedStore({ store_id: STORE_ID, created_at: '2026-09-01T10:00:00.000Z' });
    seedSavedStore({ store_id: OTHER_STORE_ID, created_at: '2026-09-15T10:00:00.000Z' });

    const res = await api().get(url('/saved-stores')).set(auth);

    expect(res.body.data.savedStores.map((entry) => entry.store.id)).toEqual([
      OTHER_STORE_ID,
      STORE_ID,
    ]);
  });

  it('never lists another customer’s saves', async () => {
    seedSavedStore({ customer_id: OTHER_CUSTOMER_ID, store_id: OTHER_STORE_ID });

    const res = await api().get(url('/saved-stores')).set(signIn());

    expect(res.body.data.savedStores).toEqual([]);
  });

  it('drops a store that has since been deactivated rather than showing a dead link', async () => {
    const auth = signIn();
    seedSavedStore();
    seedSavedStore({ store_id: OTHER_STORE_ID });
    db.tables.get('stores').find((store) => store.id === OTHER_STORE_ID).is_active = false;

    const res = await api().get(url('/saved-stores')).set(auth);

    expect(res.body.data.savedStores.map((entry) => entry.store.id)).toEqual([STORE_ID]);
  });

  it('paginates and caps the page size', async () => {
    const auth = signIn();
    seedSavedStore({ store_id: STORE_ID, created_at: '2026-09-01T10:00:00.000Z' });
    seedSavedStore({ store_id: OTHER_STORE_ID, created_at: '2026-09-02T10:00:00.000Z' });

    const page1 = await api().get(url('/saved-stores?page=1&limit=1')).set(auth);
    const page2 = await api().get(url('/saved-stores?page=2&limit=1')).set(auth);

    expect(page1.body.data.savedStores).toHaveLength(1);
    expect(page1.body.meta).toMatchObject({ page: 1, limit: 1, total: 2, hasNextPage: true });
    expect(page2.body.data.savedStores[0].store.id).toBe(STORE_ID);

    const tooBig = await api().get(url('/saved-stores?limit=500')).set(auth);
    expect(tooBig.status).toBe(422);
  });

  it('rejects an unknown query parameter', async () => {
    const res = await api().get(url('/saved-stores?sort=name')).set(signIn());

    expect(res.status).toBe(422);
  });
});

describe('the storefront reflects the save state (9.1, 3.6)', () => {
  it('flips isSaved on the store page once saved', async () => {
    const auth = signIn();

    const before = await api().get(url('/stores/sharma-kirana')).set(auth);
    await save(auth);
    const after = await api().get(url('/stores/sharma-kirana')).set(auth);

    expect(before.body.data.store.isSaved).toBe(false);
    expect(after.body.data.store.isSaved).toBe(true);
  });

  it('still reports null for an anonymous visitor after someone else saved it', async () => {
    seedSavedStore({ customer_id: OTHER_CUSTOMER_ID });

    const res = await api().get(url('/stores/sharma-kirana'));

    expect(res.status).toBe(200);
    expect(res.body.data.store.isSaved).toBeNull();
  });
});
