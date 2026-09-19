import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const {
  db,
  STORE_ID,
  CATEGORY_ID,
  resetDb,
  seedStore,
  seedCategory,
  seedProduct,
  seedProductImage,
  seedProductVariant,
} = await import('./helpers/supabaseMock.js');

const OTHER_STORE_ID = '11111111-1111-4111-8111-000000000002';

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
});

const detailUrl = (productId, slug = 'sharma-kirana') =>
  url(`/stores/${slug}/products/${productId}`);

describe('GET /api/v1/stores/:slug/products/:productId (4.1)', () => {
  it('returns the product with its images and variants', async () => {
    seedStore();
    seedCategory();
    const product = seedProduct({ name: 'Basmati Rice', price_paise: 12900, mrp_paise: 15000 });
    seedProductImage({ product_id: product.id, url: 'https://img/b.jpg', sort_order: 2 });
    seedProductImage({ product_id: product.id, url: 'https://img/a.jpg', sort_order: 1, alt_text: 'Front' });
    seedProductVariant({ product_id: product.id, name: '5 kg', price_paise: 59900, sort_order: 2 });
    seedProductVariant({ product_id: product.id, name: '1 kg', price_paise: 12900, sort_order: 1 });

    const res = await api().get(detailUrl(product.id));

    expect(res.status).toBe(200);
    expect(res.body.data.storeId).toBe(STORE_ID);
    expect(res.body.data.product).toMatchObject({
      id: product.id,
      name: 'Basmati Rice',
      pricePaise: 12900,
      mrpPaise: 15000,
      categoryId: CATEGORY_ID,
      isPurchasable: true,
    });
    // Images and variants both come back in sort_order.
    expect(res.body.data.product.images.map((image) => image.url)).toEqual([
      'https://img/a.jpg',
      'https://img/b.jpg',
    ]);
    expect(res.body.data.product.images[0].altText).toBe('Front');
    expect(res.body.data.product.variants.map((variant) => variant.name)).toEqual(['1 kg', '5 kg']);
    // The listing thumbnail is the first image, so both screens agree.
    expect(res.body.data.product.imageUrl).toBe('https://img/a.jpg');
  });

  it('opens with no token at all — a product link is shareable too (3.5)', async () => {
    seedStore();
    const product = seedProduct();

    const res = await api().get(detailUrl(product.id));

    expect(res.status).toBe(200);
  });

  it('returns empty image and variant arrays rather than nulls', async () => {
    seedStore();
    const product = seedProduct();

    const { body } = await api().get(detailUrl(product.id));

    expect(body.data.product.images).toEqual([]);
    expect(body.data.product.variants).toEqual([]);
    expect(body.data.product.imageUrl).toBeNull();
  });

  it('flags an unavailable product as non-purchasable but still returns it (4.4)', async () => {
    seedStore();
    const product = seedProduct({ is_available: false });

    const { body } = await api().get(detailUrl(product.id));

    expect(body.data.product.isAvailable).toBe(false);
    expect(body.data.product.isPurchasable).toBe(false);
  });

  it('flags a sold-out product as non-purchasable (4.4)', async () => {
    seedStore();
    const product = seedProduct({ stock: 0 });

    const { body } = await api().get(detailUrl(product.id));

    expect(body.data.product.outOfStock).toBe(true);
    expect(body.data.product.isPurchasable).toBe(false);
  });

  it('flags a sold-out variant without hiding it', async () => {
    seedStore();
    const product = seedProduct();
    seedProductVariant({ product_id: product.id, name: '5 kg', stock: 0 });

    const { body } = await api().get(detailUrl(product.id));

    expect(body.data.product.variants[0]).toMatchObject({
      name: '5 kg',
      outOfStock: true,
      isPurchasable: false,
    });
  });

  it('treats a null stock as untracked, not as sold out', async () => {
    seedStore();
    const product = seedProduct({ stock: null });

    const { body } = await api().get(detailUrl(product.id));

    expect(body.data.product.stock).toBeNull();
    expect(body.data.product.isPurchasable).toBe(true);
  });

  it("404s for a product id belonging to another store (4.5)", async () => {
    seedStore();
    seedStore({ id: OTHER_STORE_ID, slug: 'other-store' });
    const foreign = seedProduct({ store_id: OTHER_STORE_ID, slug: 'foreign-product' });

    const res = await api().get(detailUrl(foreign.id));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("404s for a product that does not exist anywhere", async () => {
    seedStore();

    const res = await api().get(detailUrl('31111111-1111-4111-8111-000000009999'));

    expect(res.status).toBe(404);
  });

  it('404s when the store slug is unknown', async () => {
    const product = seedProduct();

    const res = await api().get(detailUrl(product.id, 'no-such-store'));

    expect(res.status).toBe(404);
  });

  it('422s when the product id is not a uuid', async () => {
    seedStore();

    const res = await api().get(detailUrl('not-a-uuid'));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('surfaces a database outage as a 500, not a 404', async () => {
    seedStore();
    const product = seedProduct();
    db.failNextQuery = { message: 'connection reset' };

    const res = await api().get(detailUrl(product.id));

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('connection reset');
  });
});

describe('GET /api/v1/stores/:slug/search (4.2, 4.3)', () => {
  const searchUrl = (query, slug = 'sharma-kirana') => url(`/stores/${slug}/search?${query}`);

  beforeEach(() => {
    seedStore();
    seedCategory();
  });

  it('matches on the product name, case-insensitively', async () => {
    seedProduct({ name: 'Basmati Rice', slug: 'basmati-rice' });
    seedProduct({ name: 'Toor Dal', slug: 'toor-dal' });

    const res = await api().get(searchUrl('q=rice'));

    expect(res.status).toBe(200);
    expect(res.body.data.query).toBe('rice');
    expect(res.body.data.products.map((product) => product.name)).toEqual(['Basmati Rice']);
  });

  it('matches on the description too (4.2)', async () => {
    seedProduct({ name: 'Toor Dal', slug: 'toor-dal', description: 'Unpolished split pigeon peas' });

    const { body } = await api().get(searchUrl('q=pigeon'));

    expect(body.data.products.map((product) => product.name)).toEqual(['Toor Dal']);
  });

  it('never reaches another store, even for an exact name match (4.2)', async () => {
    seedStore({ id: OTHER_STORE_ID, slug: 'other-store' });
    seedProduct({ store_id: OTHER_STORE_ID, name: 'Basmati Rice', slug: 'basmati-rice' });

    const { body } = await api().get(searchUrl('q=basmati'));

    expect(body.data.products).toEqual([]);
  });

  it('returns a clean, fully-shaped payload when nothing matches (4.3)', async () => {
    seedProduct({ name: 'Toor Dal', slug: 'toor-dal' });

    const res = await api().get(searchUrl('q=quinoa'));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ storeId: STORE_ID, query: 'quinoa', products: [] });
    expect(res.body.meta).toMatchObject({ total: 0, totalPages: 0, hasNextPage: false });
  });

  it('returns an unavailable match, flagged non-purchasable (4.4)', async () => {
    seedProduct({ name: 'Basmati Rice', slug: 'basmati-rice', is_available: false });

    const { body } = await api().get(searchUrl('q=rice'));

    expect(body.data.products).toHaveLength(1);
    expect(body.data.products[0].isPurchasable).toBe(false);
  });

  it('rejects a one-character query (4.3)', async () => {
    const res = await api().get(searchUrl('q=r'));

    expect(res.status).toBe(422);
    expect(res.body.error.details.issues[0].field).toBe('q');
  });

  it('rejects a missing query', async () => {
    const res = await api().get(searchUrl(''));

    expect(res.status).toBe(422);
  });

  it('treats a wildcard as literal text rather than "match everything" (4.3)', async () => {
    seedProduct({ name: 'Basmati Rice', slug: 'basmati-rice' });
    seedProduct({ name: 'Toor Dal', slug: 'toor-dal' });

    const { body } = await api().get(searchUrl(`q=${encodeURIComponent('%%')}`));

    expect(body.data.products).toEqual([]);
  });

  it('paginates and caps the page size', async () => {
    for (let index = 0; index < 5; index += 1) {
      seedProduct({ name: `Rice ${index}`, slug: `rice-${index}`, sort_order: index });
    }

    const { body } = await api().get(searchUrl('q=rice&limit=2&page=2'));

    expect(body.data.products.map((product) => product.name)).toEqual(['Rice 2', 'Rice 3']);
    expect(body.meta).toMatchObject({ page: 2, limit: 2, total: 5, hasNextPage: true });

    const capped = await api().get(searchUrl('q=rice&limit=500'));
    expect(capped.status).toBe(422);
  });

  it('can be narrowed to a category, and 404s for another store’s category', async () => {
    seedStore({ id: OTHER_STORE_ID, slug: 'other-store' });
    const foreignCategory = seedCategory({
      id: '21111111-1111-4111-8111-000000000009',
      store_id: OTHER_STORE_ID,
      slug: 'foreign',
    });
    seedProduct({ name: 'Basmati Rice', slug: 'basmati-rice' });

    const narrowed = await api().get(searchUrl(`q=rice&categoryId=${CATEGORY_ID}`));
    expect(narrowed.body.data.products).toHaveLength(1);

    const foreign = await api().get(searchUrl(`q=rice&categoryId=${foreignCategory.id}`));
    expect(foreign.status).toBe(404);
  });

  it('rejects unknown query parameters instead of ignoring them', async () => {
    const res = await api().get(searchUrl('q=rice&storeId=whatever'));

    expect(res.status).toBe(422);
  });
});
