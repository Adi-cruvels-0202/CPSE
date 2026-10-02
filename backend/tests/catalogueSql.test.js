import { describe, it, expect, beforeAll } from 'vitest';
import { freshDatabase, migrate, one } from './helpers/pgdb.js';

/**
 * Migration 0031 run against real Postgres (PGlite): the catalogue writes
 * that must be all-or-nothing, and variant cost hidden from the public roles.
 */

const STORE = '00000000-0000-4000-8000-000000000001';
const OTHER_STORE = '00000000-0000-4000-8000-000000000002';
const MERCHANT = '00000000-0000-4000-8000-0000000000c1';

let template;
async function database() {
  if (!template) {
    template = await migrate(await freshDatabase());
    await template.exec(`
      insert into auth.users (id, email) values ('${MERCHANT}', 'm@shop.in');
      insert into merchants (id, email) values ('${MERCHANT}', 'm@shop.in');
      insert into stores (id, slug, name, owner_id, is_published) values
        ('${STORE}', 'shop', 'Shop', '${MERCHANT}', true),
        ('${OTHER_STORE}', 'other', 'Other', null, true);
    `);
  }
  return template.clone();
}

const rpc = async (db, fn, payload) =>
  (await db.query(`select public.${fn}($1::jsonb) as result`, [JSON.stringify(payload)])).rows[0].result;

const product = (overrides = {}) => ({
  store_id: STORE,
  merchant_id: MERCHANT,
  name: 'Basmati Rice',
  slug: 'basmati-rice',
  unit: 'kg',
  tax_percent: 5,
  track_inventory: true,
  images: [{ url: 'https://img/a.jpg', alt_text: 'Front' }, { url: 'https://img/b.jpg' }],
  variants: [
    { name: '5 kg', sku: 'RICE-5', price_paise: 59900, mrp_paise: 65000, cost_paise: 50000, opening_quantity: 10 },
    { name: '1 kg', sku: 'RICE-1', price_paise: 12900, mrp_paise: 14500, opening_quantity: 40 },
  ],
  ...overrides,
});

describe('create_product', () => {
  let db;
  let productId;
  beforeAll(async () => {
    db = await database();
    productId = await rpc(db, 'create_product', product());
  });

  it('writes the product with its cheapest variant’s price', async () => {
    const row = await one(db, `select name, price_paise, mrp_paise, tax_percent, unit from products where id = $1`, [productId]);
    expect(row).toEqual({ name: 'Basmati Rice', price_paise: 12900, mrp_paise: 14500, tax_percent: '5.00', unit: 'kg' });
  });

  it('writes every variant, in the order given, with its opening stock on the shelf', async () => {
    const { rows } = await db.query(
      `select name, sku, quantity_on_hand, sort_order, store_id from product_variants where product_id = $1 order by sort_order`,
      [productId],
    );
    expect(rows).toEqual([
      { name: '5 kg', sku: 'RICE-5', quantity_on_hand: 10, sort_order: 0, store_id: STORE },
      { name: '1 kg', sku: 'RICE-1', quantity_on_hand: 40, sort_order: 1, store_id: STORE },
    ]);
  });

  it('logs opening stock as a stock_in by the merchant, with the cost', async () => {
    const { rows } = await db.query(
      `select movement_type, on_hand_change, on_hand_after, unit_cost_paise, reason, performed_by_type, performed_by_id
         from inventory_ledger where product_id = $1 order by on_hand_change`,
      [productId],
    );
    expect(rows).toEqual([
      { movement_type: 'stock_in', on_hand_change: 10, on_hand_after: 10, unit_cost_paise: 50000, reason: 'Opening stock', performed_by_type: 'merchant', performed_by_id: MERCHANT },
      { movement_type: 'stock_in', on_hand_change: 40, on_hand_after: 40, unit_cost_paise: null, reason: 'Opening stock', performed_by_type: 'merchant', performed_by_id: MERCHANT },
    ]);
  });

  it('writes the images in order', async () => {
    const { rows } = await db.query(`select url, alt_text, sort_order from product_images where product_id = $1 order by sort_order`, [productId]);
    expect(rows).toEqual([
      { url: 'https://img/a.jpg', alt_text: 'Front', sort_order: 0 },
      { url: 'https://img/b.jpg', alt_text: null, sort_order: 1 },
    ]);
  });
});

describe('create_product is all or nothing', () => {
  it('leaves no product behind when a variant is refused', async () => {
    const db = await database();
    await rpc(db, 'create_product', product());

    // RICE-1 is taken in this store (case-insensitively), so the second product fails whole.
    await expect(
      rpc(db, 'create_product', product({ slug: 'brown-rice', name: 'Brown Rice', variants: [{ name: '1 kg', sku: 'rice-1', price_paise: 100 }] })),
    ).rejects.toThrow(/product_variants_store_sku_key/);

    expect((await one(db, `select count(*)::int as n from products`)).n).toBe(1);
  });

  it('allows the same SKU in another store', async () => {
    const db = await database();
    await rpc(db, 'create_product', product());
    await rpc(db, 'create_product', product({ store_id: OTHER_STORE }));
    expect((await one(db, `select count(*)::int as n from products`)).n).toBe(2);
  });

  it('puts no opening stock on an uncounted product', async () => {
    const db = await database();
    const id = await rpc(db, 'create_product', product({ track_inventory: false }));

    expect((await one(db, `select sum(quantity_on_hand)::int as n from product_variants where product_id = $1`, [id])).n).toBe(0);
    expect((await one(db, `select count(*)::int as n from inventory_ledger`)).n).toBe(0);
  });
});

describe('add_product_variants', () => {
  it('continues the sort order and logs opening stock', async () => {
    const db = await database();
    const id = await rpc(db, 'create_product', product());

    await rpc(db, 'add_product_variants', {
      store_id: STORE,
      product_id: id,
      merchant_id: MERCHANT,
      variants: [{ name: '10 kg', sku: 'RICE-10', price_paise: 110000, opening_quantity: 3 }],
    });

    const added = await one(db, `select sort_order, quantity_on_hand from product_variants where sku = 'RICE-10'`);
    expect(added).toEqual({ sort_order: 2, quantity_on_hand: 3 });
  });

  it('refuses a product that is not in the given store', async () => {
    const db = await database();
    const id = await rpc(db, 'create_product', product());

    await expect(
      rpc(db, 'add_product_variants', { store_id: OTHER_STORE, product_id: id, merchant_id: MERCHANT, variants: [{ name: 'x', price_paise: 1 }] }),
    ).rejects.toThrow(/PRODUCT_NOT_FOUND/);
  });
});

describe('replace_product_images', () => {
  it('replaces the whole list', async () => {
    const db = await database();
    const id = await rpc(db, 'create_product', product());

    await rpc(db, 'replace_product_images', { product_id: id, images: [{ url: 'https://img/c.jpg' }] });

    const { rows } = await db.query(`select url, sort_order from product_images where product_id = $1`, [id]);
    expect(rows).toEqual([{ url: 'https://img/c.jpg', sort_order: 0 }]);
  });
});

describe('variant cost is the merchant’s alone (P-11)', () => {
  it('cannot be read by the public roles, while price can', async () => {
    const db = await database();
    await rpc(db, 'create_product', product());

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      const visible = await db.query(`select price_paise from public.product_variants`);
      expect(visible.rows.length, role).toBe(2);
      await expect(db.query(`select cost_paise from public.product_variants`), role).rejects.toThrow(/permission denied/);
      await db.exec('reset role');
    }
  });
});
