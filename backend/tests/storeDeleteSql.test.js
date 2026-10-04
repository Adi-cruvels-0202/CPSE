import { describe, it, expect } from 'vitest';
import { freshDatabase, migrate, one } from './helpers/pgdb.js';

/**
 * Migration 0035 against real Postgres (PGlite): delete_store removes a store
 * with its orders, sales, stock history and khata — the tables that do not
 * cascade on their own — and refuses while an order is in progress.
 */

const STORE = '00000000-0000-4000-8000-000000000001';
const OTHER_STORE = '00000000-0000-4000-8000-000000000002';
const MERCHANT = '00000000-0000-4000-8000-0000000000c1';
const CUSTOMER = '00000000-0000-4000-8000-0000000000c2';
const ORDER = '00000000-0000-4000-8000-0000000000e1';

let template;
async function database() {
  if (!template) {
    template = await migrate(await freshDatabase());
    await template.exec(`
      insert into auth.users (id, email) values ('${MERCHANT}', 'm@shop.in'), ('${CUSTOMER}', 'c@test.in');
      insert into merchants (id, email) values ('${MERCHANT}', 'm@shop.in');
      insert into stores (id, slug, name, owner_id, is_published) values
        ('${STORE}', 'shop', 'Shop', '${MERCHANT}', true), ('${OTHER_STORE}', 'other', 'Other', null, true);
    `);
    for (const storeId of [STORE, OTHER_STORE]) {
      await template.query(`select public.create_product($1::jsonb)`, [
        JSON.stringify({
          store_id: storeId, merchant_id: MERCHANT, name: 'Rice', slug: 'rice', tax_percent: 0,
          images: [{ url: 'https://img/rice.jpg' }],
          variants: [{ name: '1 kg', sku: `RICE-${storeId.slice(-1)}`, price_paise: 10000, opening_quantity: 10 }],
        }),
      ]);
    }
    const v = await one(template, `select id, product_id from product_variants where store_id = $1`, [STORE]);
    await template.query(`select public.create_sale($1::jsonb)`, [
      JSON.stringify({
        store_id: STORE, merchant_id: MERCHANT, payment_method: 'cash',
        subtotal_paise: 10000, discount_paise: 0, tax_paise: 0, total_paise: 10000,
        items: [{ product_id: v.product_id, variant_id: v.id, product_name: 'Rice', quantity: 1, unit_price_paise: 10000, tax_percent: 0, tax_paise: 0, line_total_paise: 10000 }],
      }),
    ]);
    await template.exec(`
      insert into orders (id, store_id, customer_id, fulfilment_mode, subtotal_paise, total_paise, status)
      values ('${ORDER}', '${STORE}', '${CUSTOMER}', 'pickup', 10000, 10000, 'completed');
      insert into order_items (order_id, product_id, product_name, unit_price_paise, quantity, line_total_paise)
      values ('${ORDER}', '${v.product_id}', 'Rice', 10000, 1, 10000);
      insert into khata_accounts (id, customer_id, store_id)
      values ('00000000-0000-4000-8000-0000000000f1', '${CUSTOMER}', '${STORE}');
      insert into khata_transactions (account_id, type, amount_paise, order_id)
      values ('00000000-0000-4000-8000-0000000000f1', 'debit', 10000, '${ORDER}');
    `);
  }
  return template.clone();
}

const count = async (db, table, storeId = STORE) =>
  Number((await one(db, `select count(*)::int as n from ${table} where store_id = $1`, [storeId])).n);

describe('delete_store', () => {
  it('removes the store with its orders, sales, stock history and khata', async () => {
    const db = await database();
    expect(await count(db, 'inventory_ledger')).toBeGreaterThan(0);

    await db.query(`select public.delete_store($1)`, [STORE]);

    expect(await one(db, `select count(*)::int as n from stores where id = $1`, [STORE])).toEqual({ n: 0 });
    for (const table of ['products', 'product_variants', 'orders', 'sales', 'inventory_ledger', 'khata_accounts']) {
      expect(await count(db, table)).toBe(0);
    }
    expect(await one(db, `select count(*)::int as n from order_items`)).toEqual({ n: 0 });
    expect(await one(db, `select count(*)::int as n from khata_transactions`)).toEqual({ n: 0 });
    expect(await one(db, `select count(*)::int as n from product_images`)).toEqual({ n: 1 });  // the other store's
  });

  it('leaves every other store alone', async () => {
    const db = await database();
    await db.query(`select public.delete_store($1)`, [STORE]);

    expect(await count(db, 'products', OTHER_STORE)).toBe(1);
    expect(await count(db, 'inventory_ledger', OTHER_STORE)).toBe(1);
  });

  it('refuses while an order is in progress, and changes nothing', async () => {
    const db = await database();
    await db.exec(`update orders set status = 'placed' where id = '${ORDER}'`);

    await expect(db.query(`select public.delete_store($1)`, [STORE])).rejects.toThrow('ORDERS_IN_PROGRESS');
    expect(await one(db, `select count(*)::int as n from stores where id = $1`, [STORE])).toEqual({ n: 1 });
  });

  it('keeps the stock history append-only outside delete_store', async () => {
    const db = await database();
    await db.query(`select public.delete_store($1)`, [STORE]);

    await expect(db.exec(`delete from inventory_ledger where store_id = '${OTHER_STORE}'`)).rejects.toThrow('immutable');
  });

  it('answers STORE_NOT_FOUND for a store that is not there', async () => {
    const db = await database();
    await expect(db.query(`select public.delete_store($1)`, ['00000000-0000-4000-8000-000000000009'])).rejects.toThrow('STORE_NOT_FOUND');
  });

  it('can be run only by the API', async () => {
    const db = await database();
    const { rows } = await db.query(
      `select has_function_privilege('authenticated', 'public.delete_store(uuid)', 'execute') as authenticated,
              has_function_privilege('service_role', 'public.delete_store(uuid)', 'execute') as service`,
    );
    expect(rows[0]).toEqual({ authenticated: false, service: true });
  });
});
