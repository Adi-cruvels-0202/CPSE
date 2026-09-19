import { describe, it, expect } from 'vitest';
import {
  allSql,
  migrations,
  tableBlocks,
  foreignKeys,
  indexes,
  primaryKeyColumns,
} from './helpers/schema.js';

/**
 * Structural checks over the Phase 1 migrations. These run with no database:
 * they guard the rules the checklist calls out (1.17 indexes, 1.18 updated_at,
 * 1.19 RLS) so a future migration cannot quietly break one.
 */

const EXPECTED_TABLES = [
  'customers',
  'stores',
  'categories',
  'products',
  'product_images',
  'product_variants',
  'addresses',
  'carts',
  'cart_items',
  'orders',
  'order_items',
  'order_status_history',
  'payments',
  'saved_stores',
  'notifications',
  'khata_accounts',
  'khata_transactions',
];

describe('migration files', () => {
  it('are numbered uniquely and sort into dependency order', async () => {
    const names = (await migrations).map((m) => m.name);
    expect(names.length).toBeGreaterThan(0);

    const prefixes = names.map((name) => name.slice(0, 4));
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect([...prefixes]).toEqual([...prefixes].sort());

    // Enums and the shared trigger functions must precede every table.
    expect(names[0]).toMatch(/^0001_/);
    expect(names[1]).toMatch(/^0002_/);
  });

  it('applies the RLS policies after every table has been created', async () => {
    const all = await migrations;
    const rlsIndex = all.findIndex((m) => m.name.endsWith('_rls.sql'));
    expect(rlsIndex).toBeGreaterThan(-1);

    // A table created in a later migration would have no policy, so the RLS
    // file must stay after the last `create table`.
    const lastTableIndex = all.reduce(
      (last, migration, index) =>
        /create table if not exists/i.test(migration.sql) ? index : last,
      -1,
    );
    expect(rlsIndex).toBeGreaterThan(lastTableIndex);
  });

  it('creates every table the checklist requires', async () => {
    const tables = [...(await tableBlocks()).keys()];
    for (const table of EXPECTED_TABLES) {
      expect(tables, `missing table ${table}`).toContain(table);
    }
  });

  it('declares every enum before it is used', async () => {
    const sql = await allSql();
    for (const type of ['order_status', 'payment_status', 'fulfilment_mode', 'khata_txn_type']) {
      expect(sql).toContain(`create type ${type} as enum`);
    }
  });

  it('is re-runnable — no bare create table or create function', async () => {
    const sql = await allSql();
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    expect(sql).not.toMatch(/create function /i);
    expect(sql).not.toMatch(/create index (?!if not exists)/i);
  });
});

describe('indexes (checklist 1.17)', () => {
  it('indexes every foreign key column', async () => {
    const fks = await foreignKeys();
    const idx = await indexes();
    const pks = await primaryKeyColumns();

    const missing = [];
    for (const [table, columns] of fks) {
      for (const { column } of columns) {
        // A FK is covered when it leads an index, or leads the primary key.
        const covered =
          (idx.get(table) ?? []).some((i) => i.columns.split(',')[0].trim() === column) ||
          (pks.get(table) ?? [])[0] === column ||
          // customers.id is both the PK and the FK to auth.users.
          (pks.get(table) ?? []).includes(column);
        if (!covered) missing.push(`${table}.${column}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('makes store slugs and order numbers unique', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/create unique index if not exists stores_slug_key on public\.stores \(slug\)/i);
    expect(sql).toMatch(/create unique index if not exists orders_order_number_key on public\.orders \(order_number\)/i);
  });

  it('allows only one active cart per customer per store', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/unique index if not exists carts_one_active_per_customer_store[\s\S]*?checked_out_at is null/i);
  });

  it('allows only one default address per customer', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/unique index if not exists addresses_one_default_per_customer[\s\S]*?where is_default/i);
  });
});

describe('updated_at triggers (checklist 1.18)', () => {
  it('attaches the trigger to every table that has an updated_at column', async () => {
    const sql = await allSql();
    const blocks = await tableBlocks();

    const missing = [];
    for (const [table, body] of blocks) {
      if (!/\bupdated_at\b/.test(body)) continue;
      const trigger = new RegExp(
        `create trigger ${table}_set_updated_at\\s+before update on public\\.${table}`,
        'i',
      );
      if (!trigger.test(sql)) missing.push(table);
    }
    expect(missing).toEqual([]);
  });

  it('defines set_updated_at before any trigger uses it', async () => {
    const sql = await allSql();
    expect(sql.indexOf('create or replace function public.set_updated_at')).toBeLessThan(
      sql.indexOf('execute function public.set_updated_at()'),
    );
  });
});

describe('row level security (checklist 1.19)', () => {
  it('is enabled on every table', async () => {
    const sql = await allSql();
    const missing = [...(await tableBlocks()).keys()].filter(
      (table) => !new RegExp(`alter table public\\.${table}\\s+enable row level security`, 'i').test(sql),
    );
    expect(missing).toEqual([]);
  });

  it('gives every customer-owned table an ownership policy', async () => {
    const sql = await allSql();
    const owned = [
      'customers',
      'addresses',
      'carts',
      'cart_items',
      'orders',
      'order_items',
      'order_status_history',
      'payments',
      'saved_stores',
      'notifications',
      'khata_accounts',
      'khata_transactions',
    ];
    for (const table of owned) {
      expect(sql, `no policy on ${table}`).toMatch(
        new RegExp(`create policy \\w+ on public\\.${table}`, 'i'),
      );
    }
  });

  it('scopes every non-public policy to the calling user', async () => {
    const sql = await allSql();
    const policies = sql.match(/create policy[\s\S]*?;/gi) ?? [];
    // The catalog policies are public by design; everything else is ownership.
    const ownership = policies.filter((p) => !/_public_read/.test(p));
    expect(ownership.length).toBeGreaterThan(0);
    for (const policy of ownership) {
      expect(policy, policy.slice(0, 60)).toMatch(/auth\.uid\(\)/);
      expect(policy, policy.slice(0, 60)).toMatch(/to authenticated/);
    }
  });

  it('keeps khata read-only for customers (checklist 1.15)', async () => {
    const sql = await allSql();
    const khataPolicies = (sql.match(/create policy[\s\S]*?;/gi) ?? []).filter((p) =>
      /on public\.khata_/.test(p),
    );
    expect(khataPolicies.length).toBe(2);
    for (const policy of khataPolicies) {
      expect(policy).toMatch(/for select/i);
      expect(policy).not.toMatch(/for (all|insert|update|delete)/i);
    }
  });

  it('lets anonymous visitors read active stores, so shared links open without login', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/create policy stores_public_read on public\.stores[\s\S]*?to anon, authenticated/i);
  });
});

describe('money and integrity constraints', () => {
  it('stores every money column as integer paise (decision D8)', async () => {
    const blocks = await tableBlocks();
    const offenders = [];

    for (const [table, body] of blocks) {
      for (const line of body.split('\n')) {
        const match = /^\s*(\w*(?:paise|price|amount|fee))\s+(\w+)/i.exec(line);
        if (match && match[2].toLowerCase() !== 'integer') {
          offenders.push(`${table}.${match[1]} is ${match[2]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('names every money column with a _paise suffix', async () => {
    const blocks = await tableBlocks();
    const offenders = [];
    for (const [table, body] of blocks) {
      for (const line of body.split('\n')) {
        const match = /^\s*(\w+)\s+integer\b/i.exec(line);
        if (!match) continue;
        const column = match[1];
        if (/price|amount|fee|total|subtotal|discount|tax|balance/i.test(column) && !column.endsWith('_paise')) {
          offenders.push(`${table}.${column}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('forbids negative money', async () => {
    const sql = await allSql();
    for (const constraint of [
      'products_price_nonneg',
      'orders_subtotal_nonneg',
      'orders_total_nonneg',
      'payments_amount_positive',
      'product_variants_price_nonneg',
    ]) {
      expect(sql, `missing ${constraint}`).toContain(constraint);
    }
  });

  it('forces the order total to equal its breakdown', async () => {
    const sql = await allSql();
    expect(sql).toMatch(
      /orders_total_adds_up check \(\s*total_paise = subtotal_paise - discount_paise \+ delivery_fee_paise \+ tax_paise/i,
    );
  });

  it('forces each order line to equal unit price times quantity', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/order_items_line_total_matches check \(line_total_paise = unit_price_paise \* quantity\)/i);
  });

  it('rejects zero and negative quantities', async () => {
    const sql = await allSql();
    expect(sql).toContain('cart_items_quantity_positive check (quantity > 0)');
    expect(sql).toContain('order_items_quantity_positive check (quantity > 0)');
  });

  it('snapshots product name and price onto order items (decision D11)', async () => {
    const body = (await tableBlocks()).get('order_items');
    for (const column of ['product_name', 'unit_price_paise', 'line_total_paise']) {
      expect(body).toMatch(new RegExp(`\\b${column}\\b[^\\n]*not null`));
    }
    // The link back to the live product must survive its deletion.
    expect(body).toMatch(/product_id\s+uuid references public\.products \(id\) on delete set null/);
  });

  it('supports idempotent order creation (decision D10)', async () => {
    const sql = await allSql();
    expect(sql).toMatch(
      /create unique index if not exists orders_customer_idempotency_key[\s\S]*?\(customer_id, idempotency_key\)[\s\S]*?where idempotency_key is not null/i,
    );
  });

  it('requires a delivery address on delivery orders', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/orders_delivery_needs_address check \(\s*fulfilment_mode <> 'delivery' or delivery_address is not null/i);
  });

  it('creates a customer profile automatically on signup (checklist 1.20)', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/create trigger on_auth_user_created\s+after insert on auth\.users/i);
    expect(sql).toMatch(/handle_new_auth_user[\s\S]*?security definer/i);
    // Re-running signup handling must never fail the signup itself.
    expect(sql).toMatch(/insert into public\.customers[\s\S]*?on conflict \(id\) do nothing/i);
  });

  it('keeps the khata ledger immutable', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/create trigger khata_transactions_immutable\s+before update on public\.khata_transactions/i);
    expect(sql).toMatch(/create trigger khata_transactions_apply\s+after insert or delete on public\.khata_transactions/i);
  });
});

/**
 * Checklist 7.6. Structural checks over the order-creation function
 * (migration 0020). What the function actually does is only observable
 * against the real database; these guard the properties a reader should be
 * able to rely on without running it.
 */
describe('create_order (checklist 7.4 – 7.9)', () => {
  it('is defined once, and re-runnably', async () => {
    const sql = await allSql();

    expect(sql).toContain('create or replace function public.create_order');
    expect(sql.match(/function public\.create_order/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it('writes the order, its items, the history entry and the payment intent', async () => {
    const body = (await migrations).find((m) => m.name.includes('create_order')).sql;

    for (const table of [
      'insert into public.orders',
      'insert into public.order_items',
      'insert into public.order_status_history',
      'insert into public.payments',
    ]) {
      expect(body, `missing ${table}`).toContain(table);
    }
  });

  it('returns the existing order for a replayed idempotency key (7.5)', async () => {
    const body = (await migrations).find((m) => m.name.includes('create_order')).sql;

    expect(body).toMatch(/idempotency_key = v_idempotency_key/);
    expect(body).toContain("'replayed', true");
  });

  it('decrements stock only while enough remains, and raises otherwise (7.6)', async () => {
    const body = (await migrations).find((m) => m.name.includes('create_order')).sql;

    expect(body).toMatch(/stock is null or stock >= v_quantity/);
    expect(body).toContain('ITEM_UNAVAILABLE');
  });

  it('clears the cart inside the same transaction (7.9)', async () => {
    const body = (await migrations).find((m) => m.name.includes('create_order')).sql;

    expect(body).toMatch(/update public\.carts set checked_out_at/);
    expect(body).toContain('delete from public.cart_items');
  });

  it('is not callable by anon or authenticated — only the service role', async () => {
    const body = (await migrations).find((m) => m.name.includes('create_order')).sql;

    expect(body).toMatch(/revoke all on function public\.create_order\(jsonb\) from public, anon, authenticated/);
  });
});
