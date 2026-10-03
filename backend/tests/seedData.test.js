import { describe, it, expect } from 'vitest';
import { stores, khataSeed, testCustomer, flattenSeed } from '../scripts/seed-data.js';

/**
 * The seed data is fixture data for every later phase's tests, so it has to
 * satisfy the same constraints the database will enforce. Checking it here
 * fails in milliseconds instead of as a constraint violation during seeding.
 */

const { storeRows, categoryRows, productRows, imageRows, variantRows } = flattenSeed(stores);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE = /^\+?[0-9]{7,15}$/;

const unique = (values) => new Set(values).size === values.length;

describe('seed catalogue (checklist 1.21)', () => {
  it('provides two to three stores with categories and products', () => {
    expect(storeRows.length).toBeGreaterThanOrEqual(2);
    expect(storeRows.length).toBeLessThanOrEqual(3);
    expect(categoryRows.length).toBeGreaterThan(0);
    expect(productRows.length).toBeGreaterThan(0);
    expect(variantRows.length).toBeGreaterThan(0);
    expect(imageRows.length).toBeGreaterThan(0);
  });

  it('uses fixed, unique, well-formed ids everywhere, so re-seeding is idempotent', () => {
    for (const rows of [storeRows, categoryRows, productRows, imageRows, variantRows]) {
      const ids = rows.map((row) => row.id);
      expect(unique(ids)).toBe(true);
      for (const id of ids) expect(id).toMatch(UUID);
    }
    // Ids must not collide across tables either — a copy/paste slip would
    // otherwise show up only as a confusing foreign-key error.
    const all = [...storeRows, ...categoryRows, ...productRows, ...imageRows, ...variantRows];
    expect(unique(all.map((row) => row.id))).toBe(true);
  });

  it('gives every store a valid slug, contact and at least one fulfilment mode', () => {
    for (const store of storeRows) {
      expect(store.slug).toMatch(SLUG);
      expect(store.name.length).toBeGreaterThan(0);
      expect(store.pickup_enabled || store.delivery_enabled).toBe(true);
      expect(store.min_order_paise).toBeGreaterThanOrEqual(0);
      expect(store.delivery_fee_paise).toBeGreaterThanOrEqual(0);
      if (store.phone) expect(store.phone).toMatch(PHONE);
      if (store.latitude !== undefined && store.latitude !== null) {
        expect(Math.abs(store.latitude)).toBeLessThanOrEqual(90);
        expect(Math.abs(store.longitude)).toBeLessThanOrEqual(180);
      }
    }
    expect(unique(storeRows.map((s) => s.slug))).toBe(true);
  });

  it('keeps slugs unique within each store', () => {
    for (const store of storeRows) {
      const categories = categoryRows.filter((c) => c.store_id === store.id);
      expect(unique(categories.map((c) => c.slug))).toBe(true);

      const products = productRows.filter((p) => p.store_id === store.id);
      expect(unique(products.map((p) => p.slug))).toBe(true);
    }
  });

  it('prices every product and variant as a non-negative whole number of paise', () => {
    for (const row of [...productRows, ...variantRows]) {
      expect(Number.isInteger(row.price_paise)).toBe(true);
      expect(row.price_paise).toBeGreaterThanOrEqual(0);
    }
  });

  it('never sets an MRP below the selling price', () => {
    for (const product of productRows) {
      if (product.mrp_paise == null) continue;
      expect(product.mrp_paise).toBeGreaterThanOrEqual(product.price_paise);
    }
  });

  it('points every child row at a parent that exists', () => {
    const storeIds = new Set(storeRows.map((s) => s.id));
    const categoryIds = new Set(categoryRows.map((c) => c.id));
    const productIds = new Set(productRows.map((p) => p.id));

    for (const category of categoryRows) expect(storeIds.has(category.store_id)).toBe(true);
    for (const product of productRows) {
      expect(storeIds.has(product.store_id)).toBe(true);
      expect(categoryIds.has(product.category_id)).toBe(true);
    }
    for (const image of imageRows) expect(productIds.has(image.product_id)).toBe(true);
    for (const variant of variantRows) expect(productIds.has(variant.product_id)).toBe(true);
  });

  it('covers the edge cases later phases need to test against', () => {
    // An unavailable product, for cart/checkout availability rules (spec §6).
    expect(productRows.some((p) => p.is_available === false)).toBe(true);
    // A product whose stock is not counted, and one that is.
    expect(productRows.some((p) => p.track_inventory === false)).toBe(true);
    expect(productRows.some((p) => p.track_inventory === true)).toBe(true);
    // A product that charges GST and one that does not (D-4).
    expect(productRows.some((p) => p.tax_percent > 0)).toBe(true);
    expect(productRows.some((p) => p.tax_percent === 0)).toBe(true);
    // An unavailable variant.
    expect(variantRows.some((v) => v.is_available === false)).toBe(true);
    // A pickup-only store, for the "delivery not offered" branch.
    expect(storeRows.some((s) => !s.delivery_enabled)).toBe(true);
    // A store with a minimum order value, for the minimum-order rule.
    expect(storeRows.some((s) => s.min_order_paise > 0)).toBe(true);
    // A product with more than one image, for the gallery.
    const perProduct = new Map();
    for (const image of imageRows) perProduct.set(image.product_id, (perProduct.get(image.product_id) ?? 0) + 1);
    expect([...perProduct.values()].some((count) => count > 1)).toBe(true);
  });

  it('defaults availability and ordering so the rows match the column defaults', () => {
    for (const product of productRows) expect(typeof product.is_available).toBe('boolean');
    for (const variant of variantRows) {
      expect(typeof variant.is_available).toBe('boolean');
      expect(variant.sort_order).toBeGreaterThan(0);
    }
  });
});

describe('seed demo merchant (WORK_PLAN Day 5)', () => {
  it('is a separate login from the test customer, with a valid phone', async () => {
    const { demoMerchant, testCustomer } = await import('../scripts/seed-data.js');
    expect(demoMerchant.email).not.toBe(testCustomer.email);
    expect(demoMerchant.phone).toMatch(/^\+?[0-9]{7,15}$/);
    expect(demoMerchant.password.length).toBeGreaterThanOrEqual(8);
  });
});

describe('seed khata (checklist 1.22)', () => {
  it('belongs to a seeded store', () => {
    expect(storeRows.some((store) => store.id === khataSeed.storeId)).toBe(true);
  });

  it('has both debits and credits with positive whole-paise amounts', () => {
    expect(khataSeed.transactions.length).toBeGreaterThan(1);
    expect(khataSeed.transactions.some((t) => t.type === 'debit')).toBe(true);
    expect(khataSeed.transactions.some((t) => t.type === 'credit')).toBe(true);

    for (const txn of khataSeed.transactions) {
      expect(['debit', 'credit']).toContain(txn.type);
      expect(Number.isInteger(txn.amount_paise)).toBe(true);
      expect(txn.amount_paise).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(txn.occurred_at))).toBe(false);
    }
  });

  it('nets to a positive balance, matching what the 0017 trigger will compute', () => {
    const balance = khataSeed.transactions.reduce(
      (sum, txn) => sum + (txn.type === 'debit' ? txn.amount_paise : -txn.amount_paise),
      0,
    );
    expect(balance).toBe(2940);
    expect(balance).toBeGreaterThan(0);
  });
});

describe('seed test customer', () => {
  it('uses a .local address so it can never collide with a real signup', () => {
    expect(testCustomer.email).toMatch(/@cpse\.local$/);
    expect(testCustomer.email).toBe(testCustomer.email.toLowerCase());
  });

  it('has a password strong enough for Supabase Auth and a valid phone', () => {
    expect(testCustomer.password.length).toBeGreaterThanOrEqual(8);
    expect(testCustomer.phone).toMatch(PHONE);
  });
});

describe('flattenSeed', () => {
  it('returns one row per node of the nested tree', () => {
    const nestedProducts = stores.flatMap((s) => s.categories.flatMap((c) => c.products));
    expect(productRows.length).toBe(nestedProducts.length);
    expect(imageRows.length).toBe(nestedProducts.flatMap((p) => p.images ?? []).length);
    // Every product has at least one variant (D-6): its own, or a Default.
    const expectedVariants = nestedProducts.reduce((sum, p) => sum + Math.max(1, (p.variants ?? []).length), 0);
    expect(variantRows.length).toBe(expectedVariants);
  });

  it('gives a product without options exactly one Default variant (D-6)', () => {
    for (const product of productRows) {
      const own = variantRows.filter((v) => v.product_id === product.id);
      expect(own.length, product.slug).toBeGreaterThan(0);
      if (own.some((v) => v.name === 'Default')) expect(own).toHaveLength(1);
    }
  });

  it('writes stock to the variant, never the legacy columns dropped in 0030', () => {
    for (const row of [...productRows, ...variantRows]) expect(row).not.toHaveProperty('stock');
    for (const variant of variantRows) expect(Number.isInteger(variant.quantity_on_hand)).toBe(true);
  });

  it('strips the nested keys, leaving rows the tables can accept', () => {
    for (const store of storeRows) expect(store).not.toHaveProperty('categories');
    for (const category of categoryRows) expect(category).not.toHaveProperty('products');
    for (const product of productRows) {
      expect(product).not.toHaveProperty('images');
      expect(product).not.toHaveProperty('variants');
    }
  });

  it('is deterministic across calls, so seeding twice writes the same ids', () => {
    expect(flattenSeed(stores)).toEqual(flattenSeed(stores));
  });
});

describe('catalogue photos', () => {
  it('matches a file to the product whose slug it spells', async () => {
    const { photoSlug } = await import('../scripts/seed-data.js');
    expect(photoSlug('toor_dal.png')).toBe('toor-dal');
    expect(photoSlug('Basmati_Rice.JPG')).toBe('basmati-rice');
    expect(photoSlug('aloo bhujia.webp')).toBe('aloo-bhujia');
    expect(photoSlug('notes.txt')).toBeNull();
  });

  it('gives a photographed product one image row — its first, so the id stays stable', async () => {
    const { applyPhotos } = await import('../scripts/seed-data.js');
    const rows = [
      { id: 'i2', product_id: 'rice', url: 'old-2', sort_order: 2 },
      { id: 'i1', product_id: 'rice', url: 'old-1', sort_order: 1 },
      { id: 'i3', product_id: 'dal', url: 'dal-1', sort_order: 1 },
    ];

    const result = applyPhotos(rows, new Map([['rice', 'https://photo/rice.png']]));

    expect(result).toEqual([
      { id: 'i1', product_id: 'rice', url: 'https://photo/rice.png', sort_order: 1, alt_text: null },
      { id: 'i3', product_id: 'dal', url: 'dal-1', sort_order: 1 },
    ]);
  });

  it('adds a row for a photographed product that had no placeholder, with a stable id', async () => {
    const { applyPhotos } = await import('../scripts/seed-data.js');
    const productId = '31111111-1111-4111-8111-000000000004';

    const result = applyPhotos([], new Map([[productId, 'https://photo/soan.png']]));

    expect(result).toEqual([
      { id: '61111111-1111-4111-8111-900000000004', product_id: productId, url: 'https://photo/soan.png', alt_text: null, sort_order: 1 },
    ]);
  });
});
