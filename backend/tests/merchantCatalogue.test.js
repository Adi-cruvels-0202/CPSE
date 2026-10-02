import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin } = await import('../src/lib/supabase.js');
const {
  db,
  CUSTOMER_ID,
  STORE_ID,
  CATEGORY_ID,
  resetDb,
  seedCustomer,
  seedMerchant,
  seedStore,
  seedCategory,
  seedProduct,
} = await import('./helpers/supabaseMock.js');
const { generateSku } = await import('../src/modules/merchantCatalogue/product.service.js');

/**
 * A merchant's catalogue — MERCHANT_API.md, Categories and Products and
 * variants; MERCHANT_RULES §3 – §4.
 */

const OTHER_MERCHANT_ID = '81111111-1111-4111-8111-000000000099';
const OTHER_STORE_ID = '41111111-1111-4111-8111-0000000000b2';

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  seedCustomer();
  seedMerchant();
  seedStore({ owner_id: CUSTOMER_ID });
  seedStore({ id: OTHER_STORE_ID, slug: 'other-shop', owner_id: OTHER_MERCHANT_ID });
});

function signIn() {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: CUSTOMER_ID } }, error: null });
  return { Authorization: 'Bearer token-abc' };
}

const at = (path, storeId = STORE_ID) => url(`/merchant/stores/${storeId}${path}`);
const get = (path, storeId) => api().get(at(path, storeId)).set(signIn());
const post = (path, body, storeId) => api().post(at(path, storeId)).set(signIn()).send(body);
const patch = (path, body) => api().patch(at(path)).set(signIn()).send(body);
const rows = (table) => db.tables.get(table) ?? [];

const RICE = {
  name: 'India Gate Basmati Rice',
  description: 'Aged basmati',
  unit: 'kg',
  taxPercent: 5,
  lowStockThreshold: 5,
  images: [{ url: 'https://img.example/rice.jpg', altText: 'Rice bag' }],
  variants: [
    { name: '1 kg', sku: 'RICE-1KG', pricePaise: 12900, mrpPaise: 14500, costPaise: 10500, openingQuantity: 40 },
    { name: '5 kg', pricePaise: 59900, openingQuantity: 4 },
  ],
};
const createRice = (overrides = {}) => post('/products', { ...RICE, ...overrides });

// ── Categories ───────────────────────────────────────────────────────────────

describe('categories', () => {
  it('creates one at the end of the order, with a link made from its name', async () => {
    seedCategory({ sort_order: 4 });

    const res = await post('/categories', { name: 'Rice & Grains' });

    expect(res.status).toBe(201);
    expect(res.body.data.category).toMatchObject({
      name: 'Rice & Grains',
      slug: 'rice-grains',
      isActive: true,
      sortOrder: 5,
      productCount: 0,
    });
  });

  it('refuses a name the store already has, ignoring case (C-2)', async () => {
    seedCategory({ name: 'Dairy', slug: 'dairy' });

    const res = await post('/categories', { name: 'DAIRY' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'CATEGORY_NAME_TAKEN', details: { name: 'DAIRY' } });
  });

  it('allows a name another store uses', async () => {
    seedCategory({ store_id: OTHER_STORE_ID, name: 'Dairy', slug: 'dairy' });
    expect((await post('/categories', { name: 'Dairy' })).status).toBe(201);
  });

  it('lists inactive ones too, each with its product count', async () => {
    seedCategory();
    seedCategory({ id: '21111111-1111-4111-8111-0000000000c2', name: 'Retired', slug: 'retired', is_active: false, sort_order: 9 });
    seedProduct();
    seedProduct({ slug: 'dal', name: 'Dal' });

    const { body } = await get('/categories');

    expect(body.data.categories.map((c) => [c.name, c.isActive, c.productCount])).toEqual([
      ['Staples', true, 2],
      ['Retired', false, 0],
    ]);
  });

  it('refuses a rename onto another category’s name, but not onto its own', async () => {
    seedCategory();
    seedCategory({ id: '21111111-1111-4111-8111-0000000000c2', name: 'Snacks', slug: 'snacks' });

    expect((await patch(`/categories/${CATEGORY_ID}`, { name: 'snacks' })).status).toBe(409);
    expect((await patch(`/categories/${CATEGORY_ID}`, { name: 'STAPLES' })).status).toBe(200);
  });

  it('deactivating hides it from customers but keeps its products (C-4)', async () => {
    seedCategory();
    seedProduct();

    const res = await post(`/categories/${CATEGORY_ID}/deactivate`);

    expect(res.body.data.category.isActive).toBe(false);
    const categories = await api().get(url('/stores/sharma-kirana/categories'));
    expect(categories.body.data.categories).toEqual([]);
    const products = await api().get(url('/stores/sharma-kirana/products'));
    expect(products.body.data.products).toHaveLength(1);
  });

  it('treats another store’s category as missing', async () => {
    seedCategory({ store_id: OTHER_STORE_ID });
    expect((await patch(`/categories/${CATEGORY_ID}`, { name: 'Mine' })).status).toBe(404);
  });
});

// ── Products ─────────────────────────────────────────────────────────────────

describe('POST …/products', () => {
  it('creates the product, its variants, opening stock and images in one go', async () => {
    seedCategory();

    const res = await createRice({ categoryId: CATEGORY_ID });

    expect(res.status).toBe(201);
    const { product } = res.body.data;
    expect(product).toMatchObject({
      name: 'India Gate Basmati Rice',
      slug: 'india-gate-basmati-rice',
      categoryName: 'Staples',
      unit: 'kg',
      taxPercent: 5,
      trackInventory: true,
      isActive: true,
      pricePaise: 12900,
      images: [{ url: 'https://img.example/rice.jpg', altText: 'Rice bag', sortOrder: 0 }],
      stock: { quantityOnHand: 44, reservedQuantity: 0, availableQuantity: 44 },
      // The 5 kg variant's 4 left is at or under the threshold of 5.
      isLowStock: true,
    });
    expect(product.variants[0]).toMatchObject({
      name: '1 kg',
      sku: 'RICE-1KG',
      costPaise: 10500,
      quantityOnHand: 40,
      isLowStock: false,
    });
    expect(product.variants[1]).toMatchObject({ name: '5 kg', quantityOnHand: 4, isLowStock: true });
    expect(rows('inventory_ledger').map((row) => [row.movement_type, row.on_hand_change, row.reason])).toEqual([
      ['stock_in', 40, 'Opening stock'],
      ['stock_in', 4, 'Opening stock'],
    ]);
  });

  it('generates a SKU when none is given (P-5)', async () => {
    const { body } = await createRice();
    expect(body.data.product.variants[1].sku).toMatch(/^SKU-INDIAGAT-[0-9A-F]{6}$/);
  });

  it('refuses a SKU the store already uses, ignoring case', async () => {
    await createRice();

    const res = await createRice({ name: 'Brown Rice', variants: [{ name: '1 kg', sku: 'rice-1kg', pricePaise: 100 }] });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'SKU_TAKEN', details: { sku: 'rice-1kg' } });
  });

  it.each([
    ['no variants', { variants: [] }],
    ['two variants with one name', { variants: [{ name: '1 kg', pricePaise: 1 }, { name: '1 KG', pricePaise: 2 }] }],
    ['an MRP below the price', { variants: [{ name: '1 kg', pricePaise: 500, mrpPaise: 400 }] }],
    ['rupees instead of paise', { variants: [{ name: '1 kg', pricePaise: 129.5 }] }],
    ['opening stock on an uncounted product', { trackInventory: false }],
    ['a tax rate with three decimals', { taxPercent: 5.125 }],
    ['an unknown unit', { unit: 'bushel' }],
    ['an image that is not http', { images: [{ url: 'ftp://img/a.jpg' }] }],
    ['a stock field on a variant', { variants: [{ name: '1 kg', pricePaise: 100, quantityOnHand: 9 }] }],
  ])('refuses %s', async (_label, body) => {
    expect((await createRice(body)).status).toBe(422);
  });

  it('refuses a category from another store', async () => {
    seedCategory({ store_id: OTHER_STORE_ID });
    expect((await createRice({ categoryId: CATEGORY_ID })).status).toBe(404);
  });

  it('gives a second product with the same name its own link', async () => {
    await createRice();
    const { body } = await createRice({ variants: [{ name: 'Loose', pricePaise: 9900 }] });
    expect(body.data.product.slug).toBe('india-gate-basmati-rice-2');
  });
});

describe('reading products', () => {
  it('filters by search, category, active and low stock, and pages', async () => {
    seedCategory();
    await createRice({ categoryId: CATEGORY_ID });
    await createRice({ name: 'Toor Dal', variants: [{ name: 'Default', pricePaise: 16500, openingQuantity: 50 }] });
    const { body: soap } = await createRice({ name: 'Soap', variants: [{ name: 'Default', pricePaise: 4500 }] });
    await post(`/products/${soap.data.product.id}/deactivate`);

    const names = async (query) => (await get(`/products${query}`)).body.data.products.map((p) => p.name);

    expect(await names('')).toEqual(['India Gate Basmati Rice', 'Soap', 'Toor Dal']);
    expect(await names('?search=dal')).toEqual(['Toor Dal']);
    expect(await names(`?categoryId=${CATEGORY_ID}`)).toEqual(['India Gate Basmati Rice']);
    expect(await names('?isActive=true')).toEqual(['India Gate Basmati Rice', 'Toor Dal']);
    // Rice's 5 kg has 4 left and Soap has none, both under the threshold of 5.
    expect(await names('?lowStock=true')).toEqual(['India Gate Basmati Rice', 'Soap']);
    expect(await names('?lowStock=false')).toEqual(['Toor Dal']);

    const page = await get('/products?limit=2&page=2');
    expect(page.body.data.products.map((p) => p.name)).toEqual(['Toor Dal']);
    expect(page.body.meta).toMatchObject({ page: 2, limit: 2, total: 3 });
  });

  it('treats another store’s product as missing', async () => {
    const theirs = seedProduct({ store_id: OTHER_STORE_ID });
    expect((await get(`/products/${theirs.id}`)).status).toBe(404);
    expect((await patch(`/products/${theirs.id}`, { name: 'Mine' })).status).toBe(404);
  });
});

describe('PATCH …/products/:productId', () => {
  it('changes only what was sent, and replaces the images', async () => {
    seedCategory();
    const { body: created } = await createRice({ categoryId: CATEGORY_ID });
    const id = created.data.product.id;

    const { body } = await patch(`/products/${id}`, {
      taxPercent: 12,
      categoryId: null,
      images: [{ url: 'https://img.example/new.jpg' }],
    });

    expect(body.data.product).toMatchObject({
      name: 'India Gate Basmati Rice',
      taxPercent: 12,
      categoryId: null,
      images: [{ url: 'https://img.example/new.jpg', sortOrder: 0 }],
    });
    expect(rows('product_images')).toHaveLength(1);
  });

  it('keeps the product’s link when it is renamed — it is in customer links', async () => {
    const { body: created } = await createRice();
    const { body } = await patch(`/products/${created.data.product.id}`, { name: 'Basmati Gold' });
    expect(body.data.product.slug).toBe('india-gate-basmati-rice');
  });

  it('refuses a stock field — stock moves only through inventory (D-5)', async () => {
    const { body: created } = await createRice();
    expect((await patch(`/products/${created.data.product.id}`, { stock: 100 })).status).toBe(422);
  });
});

describe('active and inactive', () => {
  it('a deactivated product stays listed for customers, unavailable (P-8)', async () => {
    const { body: created } = await createRice();
    const id = created.data.product.id;

    await post(`/products/${id}/deactivate`);

    const detail = await api().get(url(`/stores/sharma-kirana/products/${id}`));
    expect(detail.body.data.product).toMatchObject({ isAvailable: false, isPurchasable: false });
  });

  it('a deactivated variant cannot be ordered, and its stock leaves the product total', async () => {
    const { body: created } = await createRice();
    const { id, variants } = created.data.product;

    const { body } = await post(`/products/${id}/variants/${variants[0].id}/deactivate`);

    expect(body.data.product.variants[0].isActive).toBe(false);
    expect(body.data.product.stock.quantityOnHand).toBe(4);
  });
});

// ── Variants ─────────────────────────────────────────────────────────────────

describe('variants', () => {
  it('adds one, with opening stock logged', async () => {
    const { body: created } = await createRice();

    const res = await post(`/products/${created.data.product.id}/variants`, {
      name: '10 kg',
      pricePaise: 110000,
      openingQuantity: 2,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.product.variants.map((v) => v.name)).toEqual(['1 kg', '5 kg', '10 kg']);
    expect(rows('inventory_ledger').at(-1)).toMatchObject({ movement_type: 'stock_in', on_hand_change: 2 });
  });

  it('refuses a second variant with the same name', async () => {
    const { body: created } = await createRice();
    const res = await post(`/products/${created.data.product.id}/variants`, { name: '5 KG', pricePaise: 1 });
    expect(res.status).toBe(409);
  });

  it('shows a simple product’s Default once it has a real option beside it', async () => {
    const { body: created } = await createRice({ name: 'Toor Dal', variants: [{ name: 'Default', pricePaise: 16500 }] });
    const id = created.data.product.id;

    const before = await api().get(url(`/stores/sharma-kirana/products/${id}`));
    expect(before.body.data.product.variants).toEqual([]);

    await post(`/products/${id}/variants`, { name: '5 kg', pricePaise: 79900 });

    const after = await api().get(url(`/stores/sharma-kirana/products/${id}`));
    expect(after.body.data.product.variants.map((v) => v.name)).toEqual(['Default', '5 kg']);
  });

  it('reprices the product when the cheapest variant’s price changes', async () => {
    const { body: created } = await createRice();
    const { id, variants } = created.data.product;

    const { body } = await patch(`/products/${id}/variants/${variants[0].id}`, { pricePaise: 11900 });

    expect(body.data.product.pricePaise).toBe(11900);
    expect(body.data.product.variants[0].pricePaise).toBe(11900);
  });

  it('refuses an MRP below the price, checked against what is stored', async () => {
    const { body: created } = await createRice();
    const { id, variants } = created.data.product;

    // MRP is 14500; a price above it is refused even though only the price was sent.
    const res = await patch(`/products/${id}/variants/${variants[0].id}`, { pricePaise: 15000 });

    expect(res.status).toBe(422);
    expect(res.body.error.details.issues[0].field).toBe('mrpPaise');
  });

  it('refuses a SKU used by another variant, but not its own', async () => {
    const { body: created } = await createRice({
      variants: [{ name: '1 kg', sku: 'A-1', pricePaise: 1 }, { name: '5 kg', sku: 'B-5', pricePaise: 2 }],
    });
    const { id, variants } = created.data.product;

    expect((await patch(`/products/${id}/variants/${variants[0].id}`, { sku: 'b-5' })).status).toBe(409);
    expect((await patch(`/products/${id}/variants/${variants[0].id}`, { sku: 'A-1' })).status).toBe(200);
  });

  it('treats a variant of another product as missing', async () => {
    const { body: first } = await createRice();
    const { body: second } = await createRice({ name: 'Dal', variants: [{ name: 'Default', pricePaise: 1 }] });

    const res = await patch(`/products/${first.data.product.id}/variants/${second.data.product.variants[0].id}`, { pricePaise: 5 });

    expect(res.status).toBe(404);
  });
});

describe('cost stays with the merchant (P-11)', () => {
  it('is in the merchant’s product and never in the customer’s', async () => {
    const { body: created } = await createRice();
    const id = created.data.product.id;
    expect(created.data.product.variants[0].costPaise).toBe(10500);

    const customer = await api().get(url(`/stores/sharma-kirana/products/${id}`));

    expect(JSON.stringify(customer.body)).not.toMatch(/cost/i);
  });
});

describe('generateSku', () => {
  it('takes up to 8 letters of the names and adds 6 random ones', () => {
    expect(generateSku('Toor Dal', 'Default')).toMatch(/^SKU-TOORDAL-[0-9A-F]{6}$/);
    expect(generateSku('Rice', '5 kg')).toMatch(/^SKU-RICE5KG-[0-9A-F]{6}$/);
    expect(generateSku('ॐ', 'ॐ')).toMatch(/^SKU-ITEM-[0-9A-F]{6}$/);
  });
});
