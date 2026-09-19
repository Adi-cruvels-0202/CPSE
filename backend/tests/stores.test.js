import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin } = await import('../src/lib/supabase.js');
const {
  db,
  STORE_ID,
  CATEGORY_ID,
  resetDb,
  seedCustomer,
  seedStore,
  seedCategory,
  seedProduct,
  seedProductImage,
  seedSavedStore,
} = await import('./helpers/supabaseMock.js');

const OTHER_STORE_ID = '11111111-1111-4111-8111-000000000002';
const OTHER_CATEGORY_ID = '21111111-1111-4111-8111-000000000009';

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
});

/** Makes the next bearer token resolve to this customer. */
function signIn(row = seedCustomer()) {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: row.id } }, error: null });
  return row;
}

describe('GET /api/v1/stores/:slug (3.1, 3.5)', () => {
  it('returns the public store payload with no token at all', async () => {
    seedStore();

    const res = await api().get(url('/stores/sharma-kirana'));

    expect(res.status).toBe(200);
    expect(res.body.data.store).toMatchObject({
      id: STORE_ID,
      slug: 'sharma-kirana',
      name: 'Sharma Kirana Store',
    });
    // A shared link must not require a session.
    expect(supabaseAdmin.auth.getUser).not.toHaveBeenCalled();
  });

  it('includes contact, location, hours, fulfilment and payment info', async () => {
    seedStore();

    const { body } = await api().get(url('/stores/sharma-kirana'));
    const store = body.data.store;

    expect(store.contact).toEqual({ phone: '+919812345601', email: 'hello@sharmakirana.local' });
    expect(store.location).toMatchObject({ city: 'Ludhiana', postalCode: '141002', country: 'IN' });
    // Numerics come back from PostgREST as strings; the payload must not.
    expect(store.location.latitude).toBeCloseTo(30.900965);
    expect(store.fulfilment).toEqual({
      pickupEnabled: true,
      deliveryEnabled: true,
      minOrderPaise: 19900,
      deliveryFeePaise: 2900,
    });
    expect(store.payment).toEqual({ online: true, cashOnDelivery: true });
    expect(store.hours.timezone).toBe('Asia/Kolkata');
  });

  it('computes open/closed server-side so every client agrees (3.2)', async () => {
    seedStore();

    const { body } = await api().get(url('/stores/sharma-kirana'));

    expect(body.data.store.hours).toHaveProperty('isOpen');
    expect(typeof body.data.store.hours.isOpen).toBe('boolean');
    // Exactly one of the two is populated, whichever state we are in.
    const { isOpen, closesAt, opensAt } = body.data.store.hours;
    expect(isOpen ? closesAt : opensAt).toBeTruthy();
    expect(isOpen ? opensAt : closesAt).toBeNull();
  });

  it('returns 404 for an unknown slug', async () => {
    seedStore();

    const res = await api().get(url('/stores/no-such-store'));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for an inactive store, not 403', async () => {
    seedStore({ is_active: false });

    const res = await api().get(url('/stores/sharma-kirana'));

    // 403 would confirm the store exists.
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed slug before querying', async () => {
    const res = await api().get(url('/stores/Not_A_Slug!'));

    expect(res.status).toBe(422);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('never exposes internal columns', async () => {
    seedStore();

    const { body } = await api().get(url('/stores/sharma-kirana'));

    expect(body.data.store).not.toHaveProperty('is_active');
    expect(body.data.store).not.toHaveProperty('min_order_paise');
  });
});

describe('is_saved flag (3.6)', () => {
  it('is null for an anonymous visitor', async () => {
    seedStore();

    const { body } = await api().get(url('/stores/sharma-kirana'));

    // null, not false — the frontend must be able to tell "not signed in"
    // from "signed in and not saved".
    expect(body.data.store.isSaved).toBeNull();
  });

  it('is true when the signed-in customer has saved the store', async () => {
    seedStore();
    const customer = signIn();
    seedSavedStore({ customer_id: customer.id, store_id: STORE_ID });

    const { body } = await api()
      .get(url('/stores/sharma-kirana'))
      .set('Authorization', 'Bearer good-token');

    expect(body.data.store.isSaved).toBe(true);
  });

  it('is false when the signed-in customer has not saved it', async () => {
    seedStore();
    signIn();

    const { body } = await api()
      .get(url('/stores/sharma-kirana'))
      .set('Authorization', 'Bearer good-token');

    expect(body.data.store.isSaved).toBe(false);
  });

  it('does not leak another customer\'s save', async () => {
    seedStore();
    const me = signIn();
    seedSavedStore({ customer_id: '00000000-0000-4000-8000-000000000999', store_id: STORE_ID });

    const { body } = await api()
      .get(url('/stores/sharma-kirana'))
      .set('Authorization', 'Bearer good-token');

    expect(body.data.store.isSaved).toBe(false);
    expect(me.id).not.toBe('00000000-0000-4000-8000-000000000999');
  });

  it('still renders the page when the token is stale', async () => {
    seedStore();
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: null, error: { status: 401 } });

    const res = await api()
      .get(url('/stores/sharma-kirana'))
      .set('Authorization', 'Bearer expired');

    expect(res.status).toBe(200);
    expect(res.body.data.store.isSaved).toBeNull();
  });
});

describe('GET /api/v1/stores/:slug/categories (3.3)', () => {
  it('returns the active categories in sort order', async () => {
    seedStore();
    seedCategory({ id: CATEGORY_ID, name: 'Snacks', slug: 'snacks', sort_order: 2 });
    seedCategory({ id: OTHER_CATEGORY_ID, name: 'Staples', slug: 'staples', sort_order: 1 });

    const res = await api().get(url('/stores/sharma-kirana/categories'));

    expect(res.status).toBe(200);
    expect(res.body.data.categories.map((c) => c.name)).toEqual(['Staples', 'Snacks']);
    expect(res.body.data.storeId).toBe(STORE_ID);
  });

  it('hides inactive categories', async () => {
    seedStore();
    seedCategory({ name: 'Staples' });
    seedCategory({ id: OTHER_CATEGORY_ID, name: 'Retired', slug: 'retired', is_active: false });

    const { body } = await api().get(url('/stores/sharma-kirana/categories'));

    expect(body.data.categories.map((c) => c.name)).toEqual(['Staples']);
  });

  it('never returns another store\'s categories', async () => {
    seedStore();
    seedStore({ id: OTHER_STORE_ID, slug: 'green-leaf-bakery' });
    seedCategory({ name: 'Mine' });
    seedCategory({ id: OTHER_CATEGORY_ID, store_id: OTHER_STORE_ID, name: 'Theirs', slug: 'theirs' });

    const { body } = await api().get(url('/stores/sharma-kirana/categories'));

    expect(body.data.categories.map((c) => c.name)).toEqual(['Mine']);
  });

  it('returns an empty list, not a 404, for a store with no categories', async () => {
    seedStore();

    const res = await api().get(url('/stores/sharma-kirana/categories'));

    expect(res.status).toBe(200);
    expect(res.body.data.categories).toEqual([]);
  });

  it('404s for an unknown store', async () => {
    const res = await api().get(url('/stores/nope/categories'));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/stores/:slug/products (3.4)', () => {
  function seedCatalogue() {
    seedStore();
    seedCategory();
    const rice = seedProduct({ name: 'Basmati Rice', slug: 'basmati-rice', sort_order: 1 });
    const dal = seedProduct({ name: 'Toor Dal', slug: 'toor-dal', sort_order: 2 });
    return { rice, dal };
  }

  it('lists the store\'s products with pagination meta', async () => {
    seedCatalogue();

    const res = await api().get(url('/stores/sharma-kirana/products'));

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(2);
    expect(res.body.meta).toEqual({
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
      hasNextPage: false,
    });
  });

  it('shapes each product for the storefront', async () => {
    const { rice } = seedCatalogue();
    seedProductImage({ product_id: rice.id, url: 'https://images.cpse.local/rice-1.jpg', sort_order: 1 });

    const { body } = await api().get(url('/stores/sharma-kirana/products'));
    const product = body.data.products.find((p) => p.id === rice.id);

    expect(product).toMatchObject({
      name: 'Basmati Rice',
      pricePaise: 12900,
      mrpPaise: 15000,
      isAvailable: true,
      outOfStock: false,
      isPurchasable: true,
      imageUrl: 'https://images.cpse.local/rice-1.jpg',
    });
  });

  it('uses the lowest sort_order image as the thumbnail', async () => {
    const { rice } = seedCatalogue();
    seedProductImage({ product_id: rice.id, url: 'https://images.cpse.local/second.jpg', sort_order: 2 });
    seedProductImage({ product_id: rice.id, url: 'https://images.cpse.local/first.jpg', sort_order: 1 });

    const { body } = await api().get(url('/stores/sharma-kirana/products'));

    expect(body.data.products.find((p) => p.id === rice.id).imageUrl).toBe(
      'https://images.cpse.local/first.jpg',
    );
  });

  it('returns a null image rather than omitting a product with no photo', async () => {
    seedCatalogue();

    const { body } = await api().get(url('/stores/sharma-kirana/products'));

    expect(body.data.products).toHaveLength(2);
    expect(body.data.products.every((p) => p.imageUrl === null)).toBe(true);
  });

  it('shows sold-out products but flags them non-purchasable', async () => {
    seedStore();
    seedCategory();
    seedProduct({ name: 'In Stock', slug: 'in-stock', stock: 5, sort_order: 1 });
    seedProduct({ name: 'Sold Out', slug: 'sold-out', stock: 0, sort_order: 2 });
    seedProduct({ name: 'Withdrawn', slug: 'withdrawn', is_available: false, stock: 9, sort_order: 3 });

    const { body } = await api().get(url('/stores/sharma-kirana/products'));
    const byName = Object.fromEntries(body.data.products.map((p) => [p.name, p]));

    expect(body.data.products).toHaveLength(3);
    expect(byName['In Stock']).toMatchObject({ outOfStock: false, isPurchasable: true });
    expect(byName['Sold Out']).toMatchObject({ outOfStock: true, isPurchasable: false });
    expect(byName.Withdrawn).toMatchObject({ isAvailable: false, isPurchasable: false });
  });

  it('treats null stock as untracked, not as zero', async () => {
    seedStore();
    seedCategory();
    seedProduct({ name: 'Untracked', slug: 'untracked', stock: null });

    const { body } = await api().get(url('/stores/sharma-kirana/products'));

    expect(body.data.products[0]).toMatchObject({ stock: null, outOfStock: false, isPurchasable: true });
  });

  it('can hide unavailable products on request', async () => {
    seedStore();
    seedCategory();
    seedProduct({ name: 'Live', slug: 'live', sort_order: 1 });
    seedProduct({ name: 'Withdrawn', slug: 'withdrawn', is_available: false, sort_order: 2 });

    const { body } = await api().get(url('/stores/sharma-kirana/products?availableOnly=true'));

    expect(body.data.products.map((p) => p.name)).toEqual(['Live']);
    expect(body.meta.total).toBe(1);
  });

  it('filters by category', async () => {
    seedStore();
    seedCategory({ id: CATEGORY_ID, name: 'Staples', slug: 'staples' });
    seedCategory({ id: OTHER_CATEGORY_ID, name: 'Snacks', slug: 'snacks' });
    seedProduct({ name: 'Rice', slug: 'rice', category_id: CATEGORY_ID });
    seedProduct({ name: 'Bhujia', slug: 'bhujia', category_id: OTHER_CATEGORY_ID });

    const { body } = await api().get(
      url(`/stores/sharma-kirana/products?categoryId=${OTHER_CATEGORY_ID}`),
    );

    expect(body.data.products.map((p) => p.name)).toEqual(['Bhujia']);
    expect(body.meta.total).toBe(1);
  });

  it('404s a category that belongs to a different store, rather than returning an empty list', async () => {
    seedStore();
    seedStore({ id: OTHER_STORE_ID, slug: 'green-leaf-bakery' });
    seedCategory({ id: OTHER_CATEGORY_ID, store_id: OTHER_STORE_ID, slug: 'theirs' });

    const res = await api().get(
      url(`/stores/sharma-kirana/products?categoryId=${OTHER_CATEGORY_ID}`),
    );

    // An empty list would confirm the id is a real category somewhere.
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/category/i);
  });

  it('never returns another store\'s products', async () => {
    seedStore();
    seedStore({ id: OTHER_STORE_ID, slug: 'green-leaf-bakery' });
    seedCategory();
    seedProduct({ name: 'Mine', slug: 'mine' });
    seedProduct({ name: 'Theirs', slug: 'theirs', store_id: OTHER_STORE_ID });

    const { body } = await api().get(url('/stores/sharma-kirana/products'));

    expect(body.data.products.map((p) => p.name)).toEqual(['Mine']);
    expect(body.meta.total).toBe(1);
  });

  describe('pagination', () => {
    function seedMany(count) {
      seedStore();
      seedCategory();
      for (let i = 1; i <= count; i += 1) {
        seedProduct({ name: `Product ${String(i).padStart(2, '0')}`, slug: `p-${i}`, sort_order: i });
      }
    }

    it('returns the requested page', async () => {
      seedMany(25);

      const { body } = await api().get(url('/stores/sharma-kirana/products?page=2&limit=10'));

      expect(body.data.products).toHaveLength(10);
      expect(body.data.products[0].name).toBe('Product 11');
      expect(body.meta).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3, hasNextPage: true });
    });

    it('reports the last page correctly', async () => {
      seedMany(25);

      const { body } = await api().get(url('/stores/sharma-kirana/products?page=3&limit=10'));

      expect(body.data.products).toHaveLength(5);
      expect(body.meta.hasNextPage).toBe(false);
    });

    it('returns an empty page past the end, with the true total', async () => {
      seedMany(5);

      const { body } = await api().get(url('/stores/sharma-kirana/products?page=9&limit=10'));

      expect(body.data.products).toEqual([]);
      expect(body.meta.total).toBe(5);
    });

    it('counts the whole filtered set, not just the page', async () => {
      seedMany(25);

      const { body } = await api().get(url('/stores/sharma-kirana/products?page=1&limit=5'));

      expect(body.data.products).toHaveLength(5);
      expect(body.meta.total).toBe(25);
    });

    it.each([
      ['page zero', 'page=0'],
      ['a negative page', 'page=-1'],
      ['a non-numeric page', 'page=two'],
      ['a limit above the cap', 'limit=500'],
      ['an unknown filter', 'colour=red'],
      ['a non-uuid categoryId', 'categoryId=abc'],
    ])('rejects %s with 422', async (_label, query) => {
      seedStore();

      const res = await api().get(url(`/stores/sharma-kirana/products?${query}`));

      expect(res.status).toBe(422);
    });
  });

  it('reports a database failure as 500 without leaking the cause', async () => {
    seedStore();
    db.failNextQuery = { message: 'relation "products" does not exist', code: '42P01' };

    const res = await api().get(url('/stores/sharma-kirana/products'));

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('42P01');
  });
});
