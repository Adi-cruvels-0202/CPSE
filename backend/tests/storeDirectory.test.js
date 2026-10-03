import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin } = await import('../src/lib/supabase.js');
const { STORE_ID, resetDb, seedStore } = await import('./helpers/supabaseMock.js');

const id = (n) => `11111111-1111-4111-8111-00000000010${n}`;

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
});

describe('GET /api/v1/stores (shop directory)', () => {
  it('lists published, active shops with no token', async () => {
    seedStore();

    const res = await api().get(url('/stores'));

    expect(res.status).toBe(200);
    expect(res.body.data.stores).toHaveLength(1);
    expect(res.body.data.stores[0]).toMatchObject({ id: STORE_ID, slug: 'sharma-kirana', name: 'Sharma Kirana Store' });
    expect(res.body.data.stores[0].hours).toHaveProperty('isOpen');
    expect(res.body.meta).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(supabaseAdmin.auth.getUser).not.toHaveBeenCalled();
  });

  it('leaves out unpublished and deactivated shops', async () => {
    seedStore();
    seedStore({ id: id(1), slug: 'draft-shop', name: 'Draft Shop', is_published: false });
    seedStore({ id: id(2), slug: 'closed-down', name: 'Closed Down', is_active: false });

    const { body } = await api().get(url('/stores'));

    expect(body.data.stores.map((store) => store.slug)).toEqual(['sharma-kirana']);
  });

  it('matches the search on name or city, case-insensitively', async () => {
    seedStore();
    seedStore({ id: id(3), slug: 'green-leaf', name: 'Green Leaf Bakery', city: 'Amritsar' });

    const byName = await api().get(url('/stores?q=LEAF'));
    const byCity = await api().get(url('/stores?q=ludhiana'));

    expect(byName.body.data.stores.map((store) => store.slug)).toEqual(['green-leaf']);
    expect(byCity.body.data.stores.map((store) => store.slug)).toEqual(['sharma-kirana']);
  });

  it('pages the list', async () => {
    seedStore();
    seedStore({ id: id(4), slug: 'second-shop', name: 'Second Shop' });

    const { body } = await api().get(url('/stores?limit=1&page=2'));

    expect(body.data.stores).toHaveLength(1);
    expect(body.meta).toMatchObject({ page: 2, limit: 1, total: 2 });
  });

  it('refuses unknown query fields and an oversized page', async () => {
    expect((await api().get(url('/stores?owner=me'))).status).toBe(422);
    expect((await api().get(url('/stores?limit=500'))).status).toBe(422);
  });
});
