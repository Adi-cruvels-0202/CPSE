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
    // A product with untracked stock (null) and one that is counted.
    expect(productRows.some((p) => p.stock === null)).toBe(true);
    expect(productRows.some((p) => typeof p.stock === 'number')).toBe(true);
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
    expect(variantRows.length).toBe(nestedProducts.flatMap((p) => p.variants ?? []).length);
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
