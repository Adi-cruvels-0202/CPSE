import { describe, it, expect, vi } from 'vitest';
import { freshDatabase, migrate, one } from './helpers/pgdb.js';

// Real Postgres in WebAssembly is CPU-heavy; when the whole suite runs in
// parallel a test here can take far longer than it does alone.
vi.setConfig({ testTimeout: 60_000 });

/**
 * record_stock_movement (migration 0032) against real Postgres (PGlite): the
 * merchant's stock movements, and the Merchant-One defects they close.
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
    const rpc = (fn, payload) => template.query(`select public.${fn}($1::jsonb)`, [JSON.stringify(payload)]);
    await rpc('create_product', {
      store_id: STORE, merchant_id: MERCHANT, name: 'Rice', slug: 'rice', track_inventory: true,
      variants: [{ name: '1 kg', sku: 'RICE-1', price_paise: 12900, opening_quantity: 10 }],
    });
    await rpc('create_product', {
      store_id: STORE, merchant_id: MERCHANT, name: 'Bread', slug: 'bread', track_inventory: false,
      variants: [{ name: 'Default', sku: 'BREAD', price_paise: 6000 }],
    });
  }
  return template.clone();
}

const variantId = async (db, sku) => (await one(db, `select id from product_variants where sku = $1`, [sku])).id;
const stock = async (db, sku) =>
  one(db, `select quantity_on_hand as "onHand", reserved_quantity as reserved from product_variants where sku = $1`, [sku]);

async function move(db, sku, payload) {
  const { rows } = await db.query(`select public.record_stock_movement($1::jsonb) as result`, [
    JSON.stringify({ store_id: STORE, merchant_id: MERCHANT, variant_id: await variantId(db, sku), ...payload }),
  ]);
  return rows[0].result;
}

/** Holds `quantity` of RICE-1 for an open order, the way create_order does. */
async function reserve(db, quantity) {
  const variant = await variantId(db, 'RICE-1');
  const product = (await one(db, `select id from products where slug = 'rice'`)).id;
  await db.query(`select public.create_order($1::jsonb)`, [
    JSON.stringify({
      customer_id: CUSTOMER, store_id: STORE, fulfilment_mode: 'pickup', status: 'placed', payment_status: 'pending',
      subtotal_paise: 12900 * quantity, discount_paise: 0, delivery_fee_paise: 0, tax_paise: 0, total_paise: 12900 * quantity,
      items: [{ product_id: product, variant_id: variant, product_name: 'Rice', unit_price_paise: 12900, quantity, line_total_paise: 12900 * quantity }],
    }),
  ]);
}

const lastEntry = (db) =>
  one(db, `select movement_type, on_hand_change, reserved_change, on_hand_after, reserved_after, unit_cost_paise, reason, notes, performed_by_type
             from inventory_ledger order by created_at desc, id desc limit 1`);

describe('stock in', () => {
  it('adds to on hand and logs it with the cost paid', async () => {
    const db = await database();

    await move(db, 'RICE-1', { kind: 'stock_in', quantity: 5, unit_cost_paise: 10000, notes: 'Weekly delivery' });

    expect(await stock(db, 'RICE-1')).toEqual({ onHand: 15, reserved: 0 });
    expect(await lastEntry(db)).toEqual({
      movement_type: 'stock_in', on_hand_change: 5, reserved_change: 0, on_hand_after: 15, reserved_after: 0,
      unit_cost_paise: 10000, reason: null, notes: 'Weekly delivery', performed_by_type: 'merchant',
    });
  });
});

describe('stock out (I-2)', () => {
  it('takes from on hand and records the reason', async () => {
    const db = await database();
    await move(db, 'RICE-1', { kind: 'stock_out', quantity: 3, reason: 'damaged' });
    expect(await stock(db, 'RICE-1')).toEqual({ onHand: 7, reserved: 0 });
    expect(await lastEntry(db)).toMatchObject({ movement_type: 'stock_out', on_hand_change: -3, reason: 'damaged' });
  });

  it('cannot take units that open orders hold — only what is available', async () => {
    const db = await database();
    await reserve(db, 8);

    await expect(move(db, 'RICE-1', { kind: 'stock_out', quantity: 3, reason: 'lost' })).rejects.toThrow(/INSUFFICIENT_STOCK:2/);
    await move(db, 'RICE-1', { kind: 'stock_out', quantity: 2, reason: 'lost' });
    expect(await stock(db, 'RICE-1')).toEqual({ onHand: 8, reserved: 8 });
  });
});

describe('a count (I-3)', () => {
  it('sets on hand and logs the difference', async () => {
    const db = await database();
    await move(db, 'RICE-1', { kind: 'adjustment', new_quantity: 6, reason: 'Counted the shelf' });
    expect(await stock(db, 'RICE-1')).toEqual({ onHand: 6, reserved: 0 });
    expect(await lastEntry(db)).toMatchObject({ movement_type: 'adjustment', on_hand_change: -4, on_hand_after: 6, reason: 'Counted the shelf' });
  });

  it('cannot go below what open orders hold', async () => {
    const db = await database();
    await reserve(db, 4);
    await expect(move(db, 'RICE-1', { kind: 'adjustment', new_quantity: 3, reason: 'x' })).rejects.toThrow(/BELOW_RESERVED:4/);
    await move(db, 'RICE-1', { kind: 'adjustment', new_quantity: 4, reason: 'x' });
    expect(await stock(db, 'RICE-1')).toEqual({ onHand: 4, reserved: 4 });
  });

  it('refuses a count that changes nothing, rather than logging an empty row', async () => {
    const db = await database();
    await expect(move(db, 'RICE-1', { kind: 'adjustment', new_quantity: 10, reason: 'x' })).rejects.toThrow(/NO_CHANGE/);
  });
});

describe('what is refused outright', () => {
  it('a product whose stock is not counted (I-9)', async () => {
    const db = await database();
    await expect(move(db, 'BREAD', { kind: 'stock_in', quantity: 5 })).rejects.toThrow(/NOT_TRACKED/);
  });

  it('a variant of another store', async () => {
    const db = await database();
    await expect(
      db.query(`select public.record_stock_movement($1::jsonb)`, [
        JSON.stringify({ store_id: OTHER_STORE, merchant_id: MERCHANT, variant_id: await variantId(db, 'RICE-1'), kind: 'stock_in', quantity: 1 }),
      ]),
    ).rejects.toThrow(/VARIANT_NOT_FOUND/);
  });

  it('an order movement, which only orders may make', async () => {
    const db = await database();
    await expect(move(db, 'RICE-1', { kind: 'order_released', quantity: 1 })).rejects.toThrow(/UNKNOWN_MOVEMENT/);
  });

  it('leaves nothing changed when it refuses', async () => {
    const db = await database();
    const before = (await one(db, `select count(*)::int as n from inventory_ledger`)).n;
    await expect(move(db, 'RICE-1', { kind: 'stock_out', quantity: 99, reason: 'lost' })).rejects.toThrow();
    expect(await stock(db, 'RICE-1')).toEqual({ onHand: 10, reserved: 0 });
    expect((await one(db, `select count(*)::int as n from inventory_ledger`)).n).toBe(before);
  });
});
