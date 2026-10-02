import { describe, it, expect } from 'vitest';
import { freshDatabase, migrate, one } from './helpers/pgdb.js';

/**
 * Migration 0033 against real Postgres (PGlite): counter sales and holidays.
 */

const STORE = '00000000-0000-4000-8000-000000000001';
const OTHER_STORE = '00000000-0000-4000-8000-000000000002';
const MERCHANT = '00000000-0000-4000-8000-0000000000c1';
const CUSTOMER = '00000000-0000-4000-8000-0000000000c2';

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
    await template.query(`select public.create_product($1::jsonb)`, [
      JSON.stringify({
        store_id: STORE, merchant_id: MERCHANT, name: 'Rice', slug: 'rice', tax_percent: 5,
        variants: [{ name: '1 kg', sku: 'RICE-1', price_paise: 10000, opening_quantity: 10 }],
      }),
    ]);
  }
  return template.clone();
}

const variant = (db) => one(db, `select v.id, v.product_id, v.quantity_on_hand, v.reserved_quantity from product_variants v where sku = 'RICE-1'`);

async function sale(db, { quantity = 2, key = null, storeId = STORE, discount = 0 } = {}) {
  const v = await variant(db);
  const subtotal = 10000 * quantity;
  const tax = Math.round(subtotal * 0.05);
  const { rows } = await db.query(`select public.create_sale($1::jsonb) as result`, [
    JSON.stringify({
      store_id: storeId, merchant_id: MERCHANT, idempotency_key: key, payment_method: 'cash',
      subtotal_paise: subtotal, discount_paise: discount, tax_paise: tax, total_paise: subtotal - discount + tax,
      items: [{ product_id: v.product_id, variant_id: v.id, product_name: 'Rice', quantity, unit_price_paise: 10000, tax_percent: 5, tax_paise: tax, line_total_paise: subtotal + tax }],
    }),
  ]);
  return rows[0].result;
}

describe('create_sale', () => {
  it('takes the stock off the shelf and logs a sale movement', async () => {
    const db = await database();
    const { sale_id: id } = await sale(db);

    expect((await variant(db)).quantity_on_hand).toBe(8);
    expect(await one(db, `select movement_type, on_hand_change, reference_type, reference_id from inventory_ledger where movement_type = 'sale'`)).toEqual({
      movement_type: 'sale', on_hand_change: -2, reference_type: 'sale', reference_id: id,
    });
    expect(await one(db, `select total_paise, tax_paise from sales where id = $1`, [id])).toEqual({ total_paise: 21000, tax_paise: 1000 });
  });

  it('numbers invoices one after another, per store', async () => {
    const db = await database();
    await sale(db, { quantity: 1 });
    await sale(db, { quantity: 1 });
    const { rows } = await db.query(`select invoice_number from sales order by invoice_number`);
    expect(rows.map((row) => row.invoice_number)).toEqual(['INV-000001', 'INV-000002']);
  });

  it('replays a key instead of selling twice', async () => {
    const db = await database();
    const first = await sale(db, { key: 'till-1' });
    const again = await sale(db, { key: 'till-1' });
    expect(again).toEqual({ sale_id: first.sale_id, replayed: true });
    expect((await variant(db)).quantity_on_hand).toBe(8);
  });

  it('cannot sell units an online order holds (X-6), and leaves nothing behind when it refuses', async () => {
    const db = await database();
    await db.exec(`update product_variants set reserved_quantity = 9 where sku = 'RICE-1'`);

    await expect(sale(db, { quantity: 2 })).rejects.toThrow(/INSUFFICIENT_STOCK:Rice:1/);
    expect((await one(db, `select count(*)::int as n from sales`)).n).toBe(0);
    expect((await one(db, `select next_invoice_number from stores where id = $1`, [STORE])).next_invoice_number).toBe(1);
  });

  it('refuses another store’s variant', async () => {
    const db = await database();
    await expect(sale(db, { storeId: OTHER_STORE })).rejects.toThrow(/VARIANT_NOT_FOUND/);
  });

  it('refuses a discount bigger than the bill (X-4)', async () => {
    const db = await database();
    await expect(sale(db, { discount: 999999 })).rejects.toThrow(/sales_total_nonneg|sales_total_adds_up/);
  });
});

describe('store_holidays', () => {
  it('allows one entry per date per store', async () => {
    const db = await database();
    await db.exec(`insert into store_holidays (store_id, holiday_date) values ('${STORE}', '2026-10-20')`);
    await expect(db.exec(`insert into store_holidays (store_id, holiday_date) values ('${STORE}', '2026-10-20')`)).rejects.toThrow(/store_holidays_store_date_key/);
    await db.exec(`insert into store_holidays (store_id, holiday_date) values ('${OTHER_STORE}', '2026-10-20')`);
  });
});
