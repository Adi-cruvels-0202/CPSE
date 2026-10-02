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
  'merchants',
  'inventory_ledger',
];

/**
 * The body of the LAST `create or replace function public.<name>` across all
 * migrations — the one in force. A later migration may redefine a function, and
 * a test reading the first definition would be checking code that no longer runs.
 */
async function latestFunction(name) {
  const sql = await allSql();
  const bodies = [...sql.matchAll(new RegExp(`create or replace function public\\.${name}\\b[\\s\\S]*?\\n\\$\\$;`, 'gi'))];
  expect(bodies.length, `${name} is never defined`).toBeGreaterThan(0);
  return bodies.at(-1)[0];
}

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

  it('enables RLS on every table in the migration that creates it, or a later one', async () => {
    // A table with RLS switched on only in an EARLIER file would sit open in
    // between. 0018 covers the tables before it; each later table carries its
    // own `enable row level security`.
    const all = await migrations;
    const wrong = [];
    all.forEach((migration, index) => {
      for (const [, table] of migration.sql.matchAll(/create table if not exists public\.(\w+)/gi)) {
        const enabled = all
          .slice(index)
          .some((later) => new RegExp(`alter table public\\.${table}\\s+enable row level security`, 'i').test(later.sql));
        if (!enabled) wrong.push(`${table} (${migration.name})`);
      }
    });
    expect(wrong).toEqual([]);
  });

  it('creates every table the checklist requires', async () => {
    const tables = [...(await tableBlocks()).keys()];
    for (const table of EXPECTED_TABLES) {
      expect(tables, `missing table ${table}`).toContain(table);
    }
  });

  it('declares every enum before it is used', async () => {
    const sql = await allSql();
    for (const type of [
      'order_status',
      'payment_status',
      'fulfilment_mode',
      'khata_txn_type',
      'shop_category',
      'product_unit',
      'inventory_movement',
    ]) {
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
      'merchants',
      'inventory_ledger',
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

  it('forces each order line to equal unit price times quantity, plus its tax (O-16)', async () => {
    const sql = await allSql();
    const definitions = [...sql.matchAll(/order_items_line_total_matches\s+check \(([^;]*?)\);/gi)];
    expect(definitions.at(-1)[1]).toBe('line_total_paise = unit_price_paise * quantity + tax_paise');
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
    const body = await latestFunction('create_order');

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
    const body = await latestFunction('create_order');

    expect(body).toMatch(/idempotency_key = v_idempotency_key/);
    expect(body).toContain("'replayed', true");
  });

  it('reserves only what is available, under a row lock, and raises otherwise (7.6, D-5)', async () => {
    const body = await latestFunction('create_order');

    expect(body).toMatch(/for update of v/);
    expect(body).toMatch(/v_on_hand - v_reserved < v_quantity/);
    expect(body).toMatch(/set reserved_quantity = reserved_quantity \+ v_quantity/);
    expect(body).toContain("'order_reserved'");
    expect(body).toContain('ITEM_UNAVAILABLE');
    // Reserving, never decrementing: on hand only moves when an order completes.
    expect(body).not.toMatch(/quantity_on_hand\s*=\s*quantity_on_hand\s*-/);
  });

  it('locks variants in a fixed order, so two orders cannot deadlock', async () => {
    expect(await latestFunction('create_order')).toMatch(/order by value ->> 'variant_id'/);
  });

  it('clears the cart inside the same transaction (7.9)', async () => {
    const body = await latestFunction('create_order');

    expect(body).toMatch(/update public\.carts set checked_out_at/);
    expect(body).toContain('delete from public.cart_items');
  });

  it('is not callable by anon or authenticated — only the service role', async () => {
    // Re-stated after every redefinition, so the file that replaces it is safe
    // on its own (the 0023 lesson).
    for (const file of (await migrations).filter((m) => /function public\.create_order/.test(m.sql))) {
      expect(file.sql, file.name).toMatch(/revoke all on function public\.create_order\(jsonb\) from public, anon, authenticated/);
    }
  });

  it('keeps the original revoke too', async () => {
    const body = (await migrations).find((m) => m.name.includes('create_order')).sql;

    expect(body).toMatch(/revoke all on function public\.create_order\(jsonb\) from public, anon, authenticated/);
  });
});

/**
 * Checklist 10.6 — no orphaned cart, checkout or order records.
 *
 * Two halves, and they are different problems. Orphans proper are prevented by
 * the schema: every foreign key states what happens when its parent goes, so
 * nothing is ever left pointing at a row that has been deleted. Records that are
 * not orphaned but are *dead* — an unpaid order holding stock, a cart nobody
 * came back to — are cleaned up by the functions in migration 0022.
 */
describe('no orphaned records (checklist 10.6)', () => {
  it('gives every foreign key an explicit ON DELETE rule', async () => {
    const fks = await foreignKeys();

    const silent = [];
    for (const [table, columns] of fks) {
      for (const { column, onDelete } of columns) {
        // Postgres defaults to NO ACTION, which fails the delete at runtime
        // instead of saying what should happen. Every FK here states its rule.
        if (!onDelete) silent.push(`${table}.${column}`);
      }
    }
    expect(silent).toEqual([]);
  });

  it('cascades a customer’s dependent rows rather than stranding them', async () => {
    const fks = await foreignKeys();
    const ruleFor = (table, column) =>
      (fks.get(table) ?? []).find((fk) => fk.column === column)?.onDelete;

    // Everything that only exists because a customer does.
    expect(ruleFor('addresses', 'customer_id')).toBe('cascade');
    expect(ruleFor('carts', 'customer_id')).toBe('cascade');
    expect(ruleFor('saved_stores', 'customer_id')).toBe('cascade');
    expect(ruleFor('notifications', 'customer_id')).toBe('cascade');
    expect(ruleFor('khata_accounts', 'customer_id')).toBe('cascade');

    // Children of a cart, an order and a khata account go with their parent.
    expect(ruleFor('cart_items', 'cart_id')).toBe('cascade');
    expect(ruleFor('order_items', 'order_id')).toBe('cascade');
    expect(ruleFor('order_status_history', 'order_id')).toBe('cascade');
    expect(ruleFor('payments', 'order_id')).toBe('cascade');
    expect(ruleFor('khata_transactions', 'account_id')).toBe('cascade');
  });

  it('refuses to delete a customer or store that still has orders', async () => {
    const fks = await foreignKeys();
    const orders = fks.get('orders') ?? [];

    // An order is a financial record. Deleting the customer must not erase it,
    // and it must not be left pointing at nothing either — so: restrict.
    expect(orders.find((fk) => fk.column === 'customer_id')?.onDelete).toBe('restrict');
    expect(orders.find((fk) => fk.column === 'store_id')?.onDelete).toBe('restrict');
  });

  it('keeps an order readable after the things it referenced are gone (D11)', async () => {
    const fks = await foreignKeys();
    const orderItems = fks.get('order_items') ?? [];

    // The snapshot on the row is what history is built from, so the live
    // reference may go null without taking the order with it.
    expect(orderItems.find((fk) => fk.column === 'product_id')?.onDelete).toBe('set null');
    expect(orderItems.find((fk) => fk.column === 'variant_id')?.onDelete).toBe('set null');
    expect((fks.get('orders') ?? []).find((fk) => fk.column === 'address_id')?.onDelete).toBe(
      'set null',
    );
  });

  it('expires stale unpaid orders, and their stock comes back through the trigger', async () => {
    const sql = await allSql();
    const body = await latestFunction('expire_stale_pending_orders');

    // Only ever touches an order nobody has paid for.
    expect(body).toMatch(/where o\.status = 'pending_payment'/i);
    // Cancelling is enough: orders_apply_stock_movement releases the stock, so
    // the sweep must not also restock by hand and release it twice.
    expect(body).not.toMatch(/quantity_on_hand|reserved_quantity|set stock/i);
    expect(sql).toMatch(/create trigger orders_apply_stock_movement\s+after update of status on public\.orders/i);
    // Records the transition like any other status change, so history stays whole.
    expect(body).toMatch(/insert into public\.order_status_history/i);
    // Two overlapping runs cannot both cancel the same order.
    expect(body).toMatch(/for update skip locked/i);
  });

  it('purges abandoned carts but never a checked-out one', async () => {
    const sql = await allSql();
    const fn = /create or replace function public\.purge_abandoned_carts[\s\S]*?\n\$\$;/i.exec(sql);

    expect(fn, 'purge_abandoned_carts is missing').toBeTruthy();
    // A checked-out cart is the provenance of an order and is kept regardless
    // of age.
    expect(fn[0]).toMatch(/where checked_out_at is null/i);
    expect(fn[0]).toMatch(/updated_at < now\(\) - p_older_than/i);
  });

  it('keeps both cleanup functions away from the customer’s own role', async () => {
    const sql = await allSql();

    for (const fn of ['expire_stale_pending_orders', 'purge_abandoned_carts']) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\(interval\\)\\s+from public`, 'i'));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\(interval\\)\\s+to service_role`, 'i'));
      // Not granted to authenticated: cancelling an order is an operator action.
      expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${fn}\\(interval\\)[^;]*authenticated`, 'i'));
    }
  });
});

/**
 * Checklist 9.7 / 9.8 — the statement aggregates. The balance itself is
 * maintained by the trigger in 0017; this function only reads.
 */
describe('khata_statement (checklist 9.7, 9.8)', () => {
  it('is defined, read-only, and re-runnable', async () => {
    const sql = await allSql();
    const fn = /create or replace function public\.khata_statement[\s\S]*?\n\$\$;/i.exec(sql);

    expect(fn, 'khata_statement is missing').toBeTruthy();
    const body = fn[0];

    expect(body).toMatch(/language sql/i);
    expect(body).toMatch(/\bstable\b/i);
    // A read-only function must not contain a write.
    expect(body).not.toMatch(/\b(insert|update|delete)\s+(into|from|public\.)/i);
  });

  it('opens at zero when the period has no lower bound', async () => {
    const sql = await allSql();
    const fn = /create or replace function public\.khata_statement[\s\S]*?\n\$\$;/i.exec(sql)[0];

    // `p_from is null or occurred_at < p_from` would match the whole ledger and
    // count it twice. The bound must be required for the opening balance.
    expect(fn).toMatch(/and p_from is not null\s*\n\s*and occurred_at < p_from/i);
  });

  it('is scoped to one account', async () => {
    const sql = await allSql();
    const fn = /create or replace function public\.khata_statement[\s\S]*?\n\$\$;/i.exec(sql)[0];

    const scoped = fn.match(/where account_id = p_account_id/gi) ?? [];
    // Both CTEs — the opening balance and the in-period totals.
    expect(scoped.length).toBe(2);
  });
});

/**
 * Every function PostgREST can expose as an RPC, and who may call it.
 *
 * This exists because of a real hole. 0021 and 0022 revoked their functions
 * `from public`, which reads like it removes everyone's access — but Supabase's
 * default privileges grant EXECUTE on a newly created function to `anon` and
 * `authenticated`, and revoking the PUBLIC pseudo-role does not take a
 * role-specific grant away. The result was three functions callable with the
 * anon key, one of which cancels orders and one of which deletes carts.
 *
 * So the rule is asserted for every function rather than remembered per
 * migration: if it is callable, it names `anon` and `authenticated` in a revoke.
 */
describe('function privileges (checklist 10.1)', () => {
  /** Callable functions — trigger functions are invoked by triggers, not RPC. */
  async function callableFunctions() {
    const sql = await allSql();
    const found = new Map();
    const re = /create or replace function public\.(\w+)\s*\(([^)]*)\)([\s\S]*?)\n\$\$;/gi;

    let match;
    while ((match = re.exec(sql)) !== null) {
      const [, name, args, body] = match;
      // `returns trigger` is not reachable over HTTP.
      if (/returns\s+trigger/i.test(body)) continue;
      found.set(name, { args: args.trim(), body });
    }
    return found;
  }

  it('found the functions to check', async () => {
    const functions = await callableFunctions();

    expect([...functions.keys()].sort()).toEqual([
      'add_product_variants',
      'create_order',
      'create_product',
      'create_sale',
      'expire_stale_pending_orders',
      'generate_order_number',
      'khata_statement',
      'purge_abandoned_carts',
      'record_stock_movement',
      'replace_product_images',
    ]);
  });

  it('revokes every callable function from anon AND authenticated, not just public', async () => {
    const sql = await allSql();
    const functions = await callableFunctions();

    const wrong = [];
    for (const name of functions.keys()) {
      // Collect every revoke naming this function, across all migrations.
      const revokes = [
        ...sql.matchAll(new RegExp(`revoke all on function public\\.${name}\\s*\\([^)]*\\)\\s*\\n?\\s*from ([^;]+);`, 'gi')),
      ].map((match) => match[1].replace(/\s+/g, ' ').toLowerCase());

      if (revokes.length === 0) {
        wrong.push(`${name}: never revoked`);
        continue;
      }
      // Supabase's default privileges mean these two must be named explicitly.
      if (!revokes.some((list) => list.includes('anon'))) wrong.push(`${name}: anon not revoked`);
      if (!revokes.some((list) => list.includes('authenticated'))) {
        wrong.push(`${name}: authenticated not revoked`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it('grants every callable function to service_role only', async () => {
    const sql = await allSql();
    const functions = await callableFunctions();

    for (const name of functions.keys()) {
      const grants = [
        ...sql.matchAll(new RegExp(`grant execute on function public\\.${name}\\s*\\([^)]*\\)\\s*\\n?\\s*to ([^;]+);`, 'gi')),
      ].map((match) => match[1].replace(/\s+/g, ' ').toLowerCase());

      for (const list of grants) {
        expect(list, `${name} is granted to anon`).not.toContain('anon');
        expect(list, `${name} is granted to authenticated`).not.toContain('authenticated');
        expect(list, `${name} should be granted to service_role`).toContain('service_role');
      }
    }
  });

  it('pins search_path on every security definer function', async () => {
    const functions = await callableFunctions();

    for (const [name, { body }] of functions) {
      if (!/security definer/i.test(body)) continue;
      // Without this, a caller-controlled search_path can redirect the tables a
      // definer-rights function touches.
      expect(body, `${name} does not pin search_path`).toMatch(/set search_path\s*=\s*public/i);
    }
  });

  it('keeps 0023 in place, since a database may have run the earlier 0021/0022', async () => {
    const migrations = await import('./helpers/schema.js').then((m) => m.migrations);
    const repair = (await migrations).find((file) => file.name.includes('revoke_function_grants'));

    expect(repair, 'the grant repair migration is missing').toBeTruthy();
    for (const name of ['khata_statement', 'expire_stale_pending_orders', 'purge_abandoned_carts']) {
      expect(repair.sql).toContain(name);
    }
  });
});

/**
 * The merchant merge (migrations 0024+). Checks the rules from
 * docs/MERCHANT_RULES.md that the schema itself must hold, whatever the API does.
 */
describe('merchant schema (MERCHANT_RULES, D-2 – D-6)', () => {
  /** Every `alter table … add column if not exists X type`, as { table, column, type }. */
  async function addedColumns() {
    const sql = await allSql();
    return [
      ...sql.matchAll(/alter table public\.(\w+)\s+add column if not exists (\w+) ([\w]+)/gi),
    ].map(([, table, column, type]) => ({ table, column, type: type.toLowerCase() }));
  }

  it('keys a merchant on the auth user, like a customer (D-2)', async () => {
    const body = (await tableBlocks()).get('merchants');
    expect(body).toMatch(/id\s+uuid primary key references auth\.users \(id\) on delete cascade/);
  });

  it('does not make every signup a merchant', async () => {
    const sql = await allSql();
    // Only the customers trigger runs on signup; becoming a merchant is an API call.
    expect(sql).not.toMatch(/insert into public\.merchants/i);
  });

  it('stores added money columns as integer paise too (D-3)', async () => {
    const offenders = (await addedColumns()).filter(
      ({ column, type }) =>
        /price|amount|fee|total|subtotal|discount|cost|threshold_paise|_paise$/.test(column) &&
        (type !== 'integer' || !column.endsWith('_paise')),
    );
    expect(offenders).toEqual([]);
  });

  it('indexes every foreign key added by alter table', async () => {
    const sql = await allSql();
    const idx = await indexes();
    const added = [
      ...sql.matchAll(/alter table public\.(\w+)\s+add column if not exists (\w+) uuid references/gi),
    ].map(([, table, column]) => ({ table, column }));

    expect(added.length).toBeGreaterThan(0);
    const missing = added.filter(
      ({ table, column }) => !(idx.get(table) ?? []).some((i) => i.columns.split(',')[0].trim() === column),
    );
    expect(missing).toEqual([]);
  });

  it('keeps existing stores visible and starts new ones unpublished (S-6)', async () => {
    const sql = await allSql();
    // Added as true so today's stores stay up, then the default flips. A
    // re-run is a no-op, so it never republishes a store a merchant took down.
    expect(sql).toMatch(/add column if not exists is_published boolean not null default true;/i);
    expect(sql).toMatch(/alter column is_published set default false;/i);
    expect(sql).not.toMatch(/update public\.stores\s+set is_published/i);
  });

  it('shows customers only stores that are both active and published', async () => {
    const sql = await allSql();
    const policies = (sql.match(/create policy (?:stores|categories|products|product_images|product_variants)_public_read[\s\S]*?;/gi) ?? []);
    // The last definition of each policy is the one in force.
    const latest = new Map(policies.map((p) => [/create policy (\w+)/i.exec(p)[1], p]));
    expect(latest.size).toBe(5);
    for (const [name, policy] of latest) {
      expect(policy, name).toMatch(/is_published/);
    }
  });

  it('requires at least one payment method on a store', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/stores_one_payment_method check \(accepts_cash or accepts_online\)/i);
  });

  it('makes category names unique per store, ignoring case (C-2)', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/unique index if not exists categories_store_name_key\s+on public\.categories \(store_id, lower\(name\)\)/i);
  });

  it('makes SKUs unique per store, not globally (P-5)', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/unique index if not exists product_variants_store_sku_key\s+on public\.product_variants \(store_id, sku\)/i);
  });

  it('ties a variant’s store to its product’s store', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/foreign key \(product_id, store_id\)\s+references public\.products \(id, store_id\)/i);
    expect(sql).toMatch(/create trigger product_variants_set_store_id\s+before insert or update of product_id on public\.product_variants/i);
  });

  it('never lets reserved stock exceed what is on hand (D-5, I-2, I-3, I-8)', async () => {
    const sql = await allSql();
    expect(sql).toContain('product_variants_on_hand_nonneg check (quantity_on_hand >= 0)');
    expect(sql).toContain('product_variants_reserved_nonneg check (reserved_quantity >= 0)');
    expect(sql).toContain('product_variants_reserved_lte_on_hand check (reserved_quantity <= quantity_on_hand)');
  });

  it('bounds the tax rate and snapshots it onto order lines (D-4)', async () => {
    const sql = await allSql();
    expect(sql).toContain('products_tax_percent_range check (tax_percent between 0 and 100)');
    expect(sql).toContain('order_items_tax_percent_range check (tax_percent between 0 and 100)');
    expect(sql).toMatch(/alter table public\.order_items\s+add column if not exists tax_paise integer not null default 0/i);
  });

  it('records both stock numbers on every ledger row (I-5, I-6)', async () => {
    const body = (await tableBlocks()).get('inventory_ledger');
    for (const column of ['on_hand_change', 'reserved_change', 'on_hand_after', 'reserved_after']) {
      expect(body).toMatch(new RegExp(`\\b${column}\\s+integer not null`));
    }
    expect(body).toMatch(/inventory_ledger_after_valid\s+check \(reserved_after <= on_hand_after\)/);
    expect(body).toMatch(/inventory_ledger_moves_something\s+check \(on_hand_change <> 0 or reserved_change <> 0\)/);
  });

  it('keeps the inventory ledger immutable', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/create trigger inventory_ledger_immutable\s+before update or delete on public\.inventory_ledger/i);
  });

  it('never lets the audit trail disappear with what it audits', async () => {
    const fks = (await foreignKeys()).get('inventory_ledger');
    expect(fks.map((fk) => fk.onDelete)).toEqual(['restrict', 'restrict', 'restrict']);
  });

  it('lets a merchant read only their own stores’ ledger', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/create policy inventory_ledger_select_owner[\s\S]*?s\.owner_id = \(select auth\.uid\(\)\)/i);
  });
});

describe('stock on the variant (migration 0030, D-5, D-6)', () => {
  it('moves off the legacy stock columns exactly once', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/if exists \(\s*select 1 from information_schema\.columns[\s\S]*?column_name = 'stock'/i);
    expect(sql).toMatch(/alter table public\.products drop column stock;/i);
    expect(sql).toMatch(/alter table public\.product_variants drop column stock;/i);
  });

  it('requires every cart line to name a variant', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/alter table public\.cart_items alter column variant_id set not null;/i);
  });

  it('releases on rejected/cancelled and fulfils on completed, from what the ledger says is held', async () => {
    const body = await latestFunction('apply_order_stock_movement');
    expect(body).toMatch(/new\.status in \('cancelled', 'rejected'\)/);
    expect(body).toMatch(/new\.status = 'completed'/);
    expect(body).toMatch(/having sum\(l\.reserved_change\) > 0/);
  });

  it('keeps a product’s price equal to its cheapest variant’s (P-10)', async () => {
    const sql = await allSql();
    expect(sql).toMatch(/create trigger product_variants_sync_product_price\s+after insert or delete or update of price_paise, mrp_paise, is_available, product_id/i);
  });
});
