import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { freshDatabase, migrate, one } from './helpers/pgdb.js';

/**
 * Migration 0030 run against real Postgres (PGlite). The API tests use a
 * JavaScript stand-in for create_order; these are what prove the SQL itself
 * reserves, releases, fulfils and backfills the way D-5 and D-6 say.
 */

const STORE = '00000000-0000-4000-8000-000000000001';
const CUSTOMER = '00000000-0000-4000-8000-0000000000c1';
const RICE = '00000000-0000-4000-8000-0000000000a1'; // has variants, counted
const DAL = '00000000-0000-4000-8000-0000000000a2'; // no variants, counted
const BREAD = '00000000-0000-4000-8000-0000000000a3'; // no variants, not counted
const RICE_1KG = '00000000-0000-4000-8000-0000000000b1';
const RICE_5KG = '00000000-0000-4000-8000-0000000000b2';
const CART = '00000000-0000-4000-8000-0000000000d1';

/** The database as it stands at 0029: stock on products and variants. */
async function buildLegacyDatabase() {
  const db = await migrate(await freshDatabase(), { to: 29 });
  await db.exec(`
    insert into auth.users (id, email) values ('${CUSTOMER}', 'c@test.local');
    insert into stores (id, slug, name) values ('${STORE}', 'shop', 'Shop');
    insert into products (id, store_id, name, slug, price_paise, mrp_paise, stock) values
      ('${RICE}',  '${STORE}', 'Rice',  'rice',  12900, 15000, 40),
      ('${DAL}',   '${STORE}', 'Dal',   'dal',   16500, 18000, 25),
      ('${BREAD}', '${STORE}', 'Bread', 'bread',  6000, null,  null);
    insert into product_variants (id, product_id, name, price_paise, stock, sort_order) values
      ('${RICE_1KG}', '${RICE}', '1 kg', 12900, 40, 1),
      ('${RICE_5KG}', '${RICE}', '5 kg', 59900, 12, 2);
    insert into carts (id, customer_id, store_id) values ('${CART}', '${CUSTOMER}', '${STORE}');
    insert into cart_items (cart_id, product_id, variant_id, quantity) values
      ('${CART}', '${DAL}',  null, 2),
      ('${CART}', '${RICE}', null, 1),
      ('${CART}', '${RICE}', '${RICE_1KG}', 3);
  `);
  return db;
}

// Building and migrating takes about a second; each test gets a clone instead.
let legacyTemplate;
let migratedTemplate;
async function legacyDatabase() {
  legacyTemplate ??= await buildLegacyDatabase();
  return legacyTemplate.clone();
}
async function migratedDatabase() {
  migratedTemplate ??= await migrate(await buildLegacyDatabase(), { from: 30 });
  return migratedTemplate.clone();
}

const variantOf = (db, productId) =>
  one(db, `select * from product_variants where product_id = $1 order by sort_order limit 1`, [productId]);

function orderPayload({ items, status = 'placed', idempotencyKey = null }) {
  const subtotal = items.reduce((sum, i) => sum + i.unit_price_paise * i.quantity, 0);
  const tax = items.reduce((sum, i) => sum + (i.tax_paise ?? 0), 0);
  return {
    customer_id: CUSTOMER,
    store_id: STORE,
    cart_id: null,
    fulfilment_mode: 'pickup',
    status,
    payment_status: 'pending',
    subtotal_paise: subtotal,
    discount_paise: 0,
    delivery_fee_paise: 0,
    tax_paise: tax,
    total_paise: subtotal + tax,
    idempotency_key: idempotencyKey,
    history_note: 'Order placed',
    items: items.map((i) => ({
      product_name: 'Item',
      line_total_paise: i.unit_price_paise * i.quantity + (i.tax_paise ?? 0),
      ...i,
    })),
  };
}

async function createOrder(db, payload) {
  const { rows } = await db.query('select public.create_order($1::jsonb) as result', [JSON.stringify(payload)]);
  return rows[0].result;
}

const ledgerFor = (db, orderId) =>
  db
    .query(
      `select movement_type, on_hand_change, reserved_change, on_hand_after, reserved_after, performed_by_type
         from inventory_ledger where reference_id = $1 order by created_at, movement_type`,
      [orderId],
    )
    .then((r) => r.rows);

describe('0030 one-time move off legacy stock (D-6)', () => {
  let db;
  beforeAll(async () => {
    db = await migratedDatabase();
  });

  it('copies a counted variant’s stock to on hand', async () => {
    const variant = await one(db, `select * from product_variants where id = $1`, [RICE_5KG]);
    expect(variant.quantity_on_hand).toBe(12);
    expect(variant.reserved_quantity).toBe(0);
    expect((await one(db, `select track_inventory from products where id = $1`, [RICE])).track_inventory).toBe(true);
  });

  it('gives a product without variants one Default variant with its price, MRP and stock', async () => {
    const variant = await variantOf(db, DAL);
    expect(variant).toMatchObject({ name: 'Default', price_paise: 16500, mrp_paise: 18000, quantity_on_hand: 25 });
    expect(variant.store_id).toBe(STORE);
  });

  it('turns `stock is null` into an untracked product', async () => {
    expect((await one(db, `select track_inventory from products where id = $1`, [BREAD])).track_inventory).toBe(false);
    expect((await variantOf(db, BREAD)).quantity_on_hand).toBe(0);
  });

  it('points variant-less cart lines at a variant, dropping one that would duplicate a line', async () => {
    const { rows } = await db.query(`select product_id, variant_id, quantity from cart_items order by quantity`);
    const dal = await variantOf(db, DAL);
    expect(rows).toEqual([
      { product_id: DAL, variant_id: dal.id, quantity: 2 },
      { product_id: RICE, variant_id: RICE_1KG, quantity: 3 },
    ]);
  });

  it('drops the legacy columns and requires a variant on every cart line', async () => {
    const legacy = await one(
      db,
      `select count(*)::int as n from information_schema.columns
        where table_schema = 'public' and column_name = 'stock'
          and table_name in ('products', 'product_variants')`,
    );
    expect(legacy.n).toBe(0);
    await expect(
      db.exec(`insert into cart_items (cart_id, product_id, variant_id, quantity) values ('${CART}', '${BREAD}', null, 1)`),
    ).rejects.toThrow(/null value/);
  });

  it('is a no-op when applied again', async () => {
    const before = await one(db, `select count(*)::int as n from product_variants`);
    await migrate(db, { from: 30 });
    expect((await one(db, `select count(*)::int as n from product_variants`)).n).toBe(before.n);
  });
});

describe('product price follows its cheapest variant (P-10)', () => {
  let db;
  beforeEach(async () => {
    db = await migratedDatabase();
  });

  it('updates the product when a variant is repriced', async () => {
    await db.exec(`update product_variants set price_paise = 9900 where id = '${RICE_1KG}'`);
    expect((await one(db, `select price_paise from products where id = $1`, [RICE])).price_paise).toBe(9900);
  });

  it('skips an unavailable variant while an available one exists', async () => {
    await db.exec(`update product_variants set is_available = false where id = '${RICE_1KG}'`);
    expect((await one(db, `select price_paise from products where id = $1`, [RICE])).price_paise).toBe(59900);
  });
});

describe('create_order reserves stock (D-5)', () => {
  let db;
  let riceDefault;
  beforeEach(async () => {
    db = await migratedDatabase();
    riceDefault = { product_id: RICE, variant_id: RICE_5KG, unit_price_paise: 59900, sku: 'RICE-5', tax_percent: 5, tax_paise: 2995 };
  });

  it('reserves, leaves on hand alone, and logs it against the order', async () => {
    const result = await createOrder(db, orderPayload({ items: [{ ...riceDefault, quantity: 2 }] }));

    const variant = await one(db, `select quantity_on_hand, reserved_quantity from product_variants where id = $1`, [RICE_5KG]);
    expect(variant).toEqual({ quantity_on_hand: 12, reserved_quantity: 2 });
    expect(await ledgerFor(db, result.order_id)).toEqual([
      { movement_type: 'order_reserved', on_hand_change: 0, reserved_change: 2, on_hand_after: 12, reserved_after: 2, performed_by_type: 'customer' },
    ]);
  });

  it('stores SKU and tax on the line, with tax inside the line total (O-16)', async () => {
    const result = await createOrder(db, orderPayload({ items: [{ ...riceDefault, quantity: 2 }] }));
    const line = await one(db, `select sku, tax_percent, tax_paise, line_total_paise from order_items where order_id = $1`, [result.order_id]);
    expect(line).toEqual({ sku: 'RICE-5', tax_percent: '5.00', tax_paise: 2995, line_total_paise: 119800 + 2995 });
  });

  it('refuses a line total that leaves out its tax', async () => {
    const payload = orderPayload({ items: [{ ...riceDefault, quantity: 1 }] });
    payload.items[0].line_total_paise = 59900;
    await expect(createOrder(db, payload)).rejects.toThrow(/order_items_line_total_matches/);
  });

  it('sells only what is available, so two customers cannot both buy the last units', async () => {
    await createOrder(db, orderPayload({ items: [{ ...riceDefault, quantity: 10 }] }));
    await expect(createOrder(db, orderPayload({ items: [{ ...riceDefault, quantity: 3 }] }))).rejects.toThrow(
      /ITEM_UNAVAILABLE/,
    );
    // The failed order left nothing behind.
    expect((await one(db, `select count(*)::int as n from orders`)).n).toBe(1);
    expect((await one(db, `select reserved_quantity from product_variants where id = $1`, [RICE_5KG])).reserved_quantity).toBe(10);
  });

  it('never reserves an untracked product', async () => {
    const bread = await variantOf(db, BREAD);
    const result = await createOrder(
      db,
      orderPayload({ items: [{ product_id: BREAD, variant_id: bread.id, unit_price_paise: 6000, quantity: 500 }] }),
    );
    expect(await ledgerFor(db, result.order_id)).toEqual([]);
    expect((await one(db, `select reserved_quantity from product_variants where id = $1`, [bread.id])).reserved_quantity).toBe(0);
  });

  it('refuses an unavailable variant, and a line without a variant', async () => {
    await db.exec(`update product_variants set is_available = false where id = '${RICE_5KG}'`);
    await expect(createOrder(db, orderPayload({ items: [{ ...riceDefault, quantity: 1 }] }))).rejects.toThrow(/ITEM_UNAVAILABLE/);
    await expect(
      createOrder(db, orderPayload({ items: [{ ...riceDefault, variant_id: null, quantity: 1 }] })),
    ).rejects.toThrow(/ITEM_UNAVAILABLE/);
  });

  it('replays an idempotency key without reserving twice', async () => {
    const payload = orderPayload({ items: [{ ...riceDefault, quantity: 2 }], idempotencyKey: 'k-1' });
    await createOrder(db, payload);
    const replay = await createOrder(db, payload);
    expect(replay.replayed).toBe(true);
    expect((await one(db, `select reserved_quantity from product_variants where id = $1`, [RICE_5KG])).reserved_quantity).toBe(2);
  });
});

describe('ending an order releases or fulfils its reservation', () => {
  let db;
  let orderId;
  beforeEach(async () => {
    db = await migratedDatabase();
    const result = await createOrder(
      db,
      orderPayload({
        items: [
          { product_id: RICE, variant_id: RICE_5KG, unit_price_paise: 59900, quantity: 2 },
          { product_id: RICE, variant_id: RICE_1KG, unit_price_paise: 12900, quantity: 5 },
        ],
      }),
    );
    orderId = result.order_id;
  });

  const stock = async () =>
    (await db.query(`select id, quantity_on_hand, reserved_quantity from product_variants where product_id = $1 order by sort_order`, [RICE])).rows.map(
      ({ quantity_on_hand, reserved_quantity }) => [quantity_on_hand, reserved_quantity],
    );

  it.each(['cancelled', 'rejected'])('%s → returns exactly what was reserved', async (status) => {
    await db.exec(`update orders set status = '${status}' where id = '${orderId}'`);
    expect(await stock()).toEqual([[40, 0], [12, 0]]);
    const released = (await ledgerFor(db, orderId)).filter((row) => row.movement_type === 'order_released');
    expect(released.map((row) => row.reserved_change).sort()).toEqual([-2, -5]);
    expect(released.every((row) => row.performed_by_type === 'system')).toBe(true);
  });

  it('completed → takes the stock off the shelf and clears the reservation', async () => {
    for (const status of ['accepted', 'preparing', 'ready_for_pickup', 'completed']) {
      await db.exec(`update orders set status = '${status}' where id = '${orderId}'`);
    }
    expect(await stock()).toEqual([[35, 0], [10, 0]]);
    const fulfilled = (await ledgerFor(db, orderId)).filter((row) => row.movement_type === 'order_fulfilled');
    expect(fulfilled.map((row) => row.on_hand_change).sort()).toEqual([-2, -5]);
  });

  it('moves nothing on the steps in between', async () => {
    await db.exec(`update orders set status = 'accepted' where id = '${orderId}'`);
    expect(await stock()).toEqual([[40, 5], [12, 2]]);
  });

  it('cannot release twice', async () => {
    await db.exec(`update orders set status = 'cancelled' where id = '${orderId}'`);
    await db.exec(`update orders set status = 'rejected' where id = '${orderId}'`);
    expect(await stock()).toEqual([[40, 0], [12, 0]]);
  });

  it('releases nothing for an order placed before reservations existed', async () => {
    await db.exec(`
      insert into orders (id, store_id, customer_id, fulfilment_mode, subtotal_paise, total_paise)
      values ('00000000-0000-4000-8000-0000000000e9', '${STORE}', '${CUSTOMER}', 'pickup', 100, 100);
      update orders set status = 'cancelled' where id = '00000000-0000-4000-8000-0000000000e9';
    `);
    expect(await stock()).toEqual([[40, 5], [12, 2]]);
  });

  it('the expiry sweep releases an unpaid order’s stock', async () => {
    await db.exec(`update orders set status = 'pending_payment', placed_at = now() - interval '3 hours' where id = '${orderId}'`);
    await db.query(`select * from expire_stale_pending_orders(interval '2 hours')`);
    expect((await one(db, `select status from orders where id = $1`, [orderId])).status).toBe('cancelled');
    expect(await stock()).toEqual([[40, 0], [12, 0]]);
  });
});

describe('the seed data fits the migrated schema', () => {
  /** INSERT with exactly the columns the rows carry, so column defaults still apply. */
  async function insertRows(db, table, rows) {
    for (const row of rows) {
      const columns = Object.keys(row);
      const values = columns.map((column) =>
        row[column] !== null && typeof row[column] === 'object' ? JSON.stringify(row[column]) : row[column],
      );
      await db.query(
        `insert into public.${table} (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
        values,
      );
    }
  }

  it('inserts every seed row, and each product shows its cheapest variant’s price', async () => {
    const { stores, flattenSeed } = await import('../scripts/seed-data.js');
    const rows = flattenSeed(stores);
    const db = await migrate(await freshDatabase());

    await insertRows(db, 'stores', rows.storeRows);
    await insertRows(db, 'categories', rows.categoryRows);
    await insertRows(db, 'products', rows.productRows);
    await insertRows(db, 'product_images', rows.imageRows);
    await insertRows(db, 'product_variants', rows.variantRows);

    const mismatched = await db.query(`
      select p.slug from products p
       where p.price_paise <> (select min(v.price_paise) from product_variants v
                                where v.product_id = p.id and v.is_available)`);
    expect(mismatched.rows).toEqual([]);
    expect((await one(db, `select count(*)::int as n from product_variants where store_id is null`)).n).toBe(0);
  });
});
