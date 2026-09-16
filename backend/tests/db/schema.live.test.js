import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { sslFor } from '../../scripts/migrate.js';

/**
 * Live schema tests. These run only when DATABASE_URL is set, so the default
 * `npm test` stays offline and fast:
 *
 *   npm run db:migrate && DATABASE_URL=... npm test
 *
 * They assert the behaviour the static tests in schema.test.js cannot see —
 * that the constraints and triggers actually fire.
 */
const connectionString = process.env.DATABASE_URL;
const live = connectionString ? describe : describe.skip;

live('live schema', () => {
  /** @type {pg.Client} */
  let db;

  beforeAll(async () => {
    db = new pg.Client({ connectionString, ssl: sslFor(connectionString) });
    await db.connect();
  });

  afterAll(async () => {
    await db?.end();
  });

  const tableNames = async () => {
    const { rows } = await db.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
    );
    return rows.map((r) => r.table_name);
  };

  it('has every table applied', async () => {
    const tables = await tableNames();
    for (const table of [
      'customers', 'stores', 'categories', 'products', 'product_images', 'product_variants',
      'addresses', 'carts', 'cart_items', 'orders', 'order_items', 'order_status_history',
      'payments', 'saved_stores', 'notifications', 'khata_accounts', 'khata_transactions',
    ]) {
      expect(tables, `missing ${table}`).toContain(table);
    }
  });

  it('has RLS enabled on every table', async () => {
    const { rows } = await db.query(
      "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
        "where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity",
    );
    const unprotected = rows.map((r) => r.relname).filter((name) => name !== 'schema_migrations');
    expect(unprotected).toEqual([]);
  });

  it('has an index on every foreign key column', async () => {
    const { rows } = await db.query(`
      select c.conrelid::regclass::text as table_name, a.attname as column_name
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f'
         and c.connamespace = 'public'::regnamespace
         and not exists (
           select 1 from pg_index i
            where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
         )
    `);
    expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([]);
  });

  it('rejects an order whose total does not match its breakdown', async () => {
    await expect(
      db.query(`
        insert into orders (store_id, customer_id, fulfilment_mode,
                            subtotal_paise, delivery_fee_paise, total_paise)
        values (gen_random_uuid(), gen_random_uuid(), 'pickup', 10000, 2900, 10000)
      `),
    ).rejects.toThrow(/orders_total_adds_up/);
  });

  it('rejects a negative price', async () => {
    await expect(
      db.query(`
        insert into products (store_id, name, slug, price_paise)
        values (gen_random_uuid(), 'Bad', 'bad', -1)
      `),
    ).rejects.toThrow(/products_price_nonneg/);
  });

  it('generates a unique, readable order number by default', async () => {
    const { rows } = await db.query('select public.generate_order_number() as n from generate_series(1, 50)');
    const numbers = rows.map((r) => r.n);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const number of numbers) expect(number).toMatch(/^CPSE-\d{6}-[2-9A-HJ-NP-Z]{6}$/);
  });

  it('keeps the khata balance in step with its ledger', async () => {
    await db.query('begin');
    try {
      const { rows: [store] } = await db.query(
        "insert into stores (slug, name) values ('t-khata-' || substr(gen_random_uuid()::text, 1, 8), 'T') returning id",
      );
      // A khata account needs a real customer, which needs a real auth user.
      const { rows: [user] } = await db.query(
        "insert into auth.users (id, instance_id, aud, role, email) " +
          "values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', " +
          "'khata-' || substr(gen_random_uuid()::text, 1, 8) || '@cpse.local') returning id",
      );
      const { rows: [account] } = await db.query(
        'insert into khata_accounts (customer_id, store_id) values ($1, $2) returning id, balance_paise',
        [user.id, store.id],
      );
      expect(account.balance_paise).toBe(0);

      await db.query(
        "insert into khata_transactions (account_id, type, amount_paise) values ($1, 'debit', 5000), ($1, 'credit', 2000)",
        [account.id],
      );
      const { rows: [after] } = await db.query('select balance_paise from khata_accounts where id = $1', [account.id]);
      expect(after.balance_paise).toBe(3000);

      // The ledger is append-only.
      await expect(
        db.query("update khata_transactions set amount_paise = 1 where account_id = $1", [account.id]),
      ).rejects.toThrow(/immutable/);
    } finally {
      await db.query('rollback');
    }
  });

  it('creates a customers row when an auth user signs up', async () => {
    await db.query('begin');
    try {
      const email = `signup-${Date.now()}@cpse.local`;
      const { rows: [user] } = await db.query(
        "insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) " +
          "values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, " +
          `'{"full_name": "Trigger Test"}'::jsonb) returning id`,
        [email],
      );
      const { rows } = await db.query('select email, full_name from customers where id = $1', [user.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].full_name).toBe('Trigger Test');
    } finally {
      await db.query('rollback');
    }
  });

  it('touches updated_at on update', async () => {
    await db.query('begin');
    try {
      const { rows: [store] } = await db.query(
        "insert into stores (slug, name) values ('t-touch-' || substr(gen_random_uuid()::text, 1, 8), 'T') returning id, updated_at",
      );
      const { rows: [updated] } = await db.query(
        "update stores set name = 'T2', updated_at = '2000-01-01' where id = $1 returning updated_at",
        [store.id],
      );
      // The trigger overwrites whatever the caller sent.
      expect(new Date(updated.updated_at).getFullYear()).toBeGreaterThan(2000);
    } finally {
      await db.query('rollback');
    }
  });

  it('allows only one active cart per customer per store', async () => {
    await db.query('begin');
    try {
      const { rows: [store] } = await db.query(
        "insert into stores (slug, name) values ('t-cart-' || substr(gen_random_uuid()::text, 1, 8), 'T') returning id",
      );
      const { rows: [user] } = await db.query(
        "insert into auth.users (id, instance_id, aud, role, email) " +
          "values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', " +
          "'cart-' || substr(gen_random_uuid()::text, 1, 8) || '@cpse.local') returning id",
      );
      await db.query('insert into carts (customer_id, store_id) values ($1, $2)', [user.id, store.id]);
      await expect(
        db.query('insert into carts (customer_id, store_id) values ($1, $2)', [user.id, store.id]),
      ).rejects.toThrow(/carts_one_active_per_customer_store/);
    } finally {
      await db.query('rollback');
    }
  });
});
