import { vi } from 'vitest';

/**
 * A stand-in for src/lib/supabase.js.
 *
 * The auth calls are plain spies that each test stages, because what matters
 * there is how we translate Supabase's replies. `from(table)` instead runs
 * against small in-memory tables through a builder that mimics the parts of
 * PostgREST we actually use — eq/in/order/range/count, and maybeSingle/single.
 * A spy returning a fixed object would not catch a handler that filters on the
 * wrong column, which is exactly the bug that leaks another store's data.
 *
 * Used through `vi.mock`, which hoists above imports:
 *
 *   vi.mock('../src/lib/supabase.js', async () => {
 *     const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
 *     return createSupabaseMock();
 *   });
 */

export const CUSTOMER_ID = '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e12';
export const STORE_ID = '11111111-1111-4111-8111-000000000001';
export const CATEGORY_ID = '21111111-1111-4111-8111-000000000001';

export const db = {
  /** id -> customers row. A Map because profile updates address rows by id. */
  customers: new Map(),
  /** table name -> rows */
  tables: new Map(),
  /** Set to force the next read to fail. */
  failNextQuery: null,
  /** Set to force the next update to fail. */
  failNextUpdate: null,
  /** Set to force the next insert to fail. */
  failNextInsert: null,
  /**
   * Set to make the next insert raise Postgres' unique-violation (23505),
   * which is how a duplicate Idempotency-Key surfaces in production.
   */
  uniqueViolationOnInsert: null,
};

const KNOWN_TABLES = [
  'customers',
  'stores',
  'categories',
  'products',
  'product_images',
  'product_variants',
  'saved_stores',
  'addresses',
  'carts',
  'cart_items',
  'orders',
  'order_items',
  'order_status_history',
  'payments',
  'notifications',
  'khata_accounts',
  'khata_transactions',
];

/** A row as the wire would deliver it: a snapshot, not a live reference. */
const copy = (row) => (row === null || row === undefined ? row : structuredClone(row));

function rowsOf(table) {
  if (table === 'customers') return [...db.customers.values()];
  return db.tables.get(table) ?? [];
}

export function resetDb() {
  db.customers.clear();
  db.tables.clear();
  db.failNextQuery = null;
  db.failNextUpdate = null;
  db.failNextInsert = null;
  db.uniqueViolationOnInsert = null;
  idCounter = 0;
}

/** Stand-in for gen_random_uuid(): stable, readable and unique per test. */
let idCounter = 0;
export function nextId(prefix = '7') {
  idCounter += 1;
  return `${prefix}1111111-1111-4111-8111-${String(idCounter).padStart(12, '0')}`;
}

function insert(table, row) {
  if (table === 'customers') {
    db.customers.set(row.id, row);
    return row;
  }
  if (!db.tables.has(table)) db.tables.set(table, []);
  db.tables.get(table).push(row);
  return row;
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// Each one mirrors the columns its migration declares, so a handler reading a
// column that does not exist gets undefined here too.

/** A complete customers row (migration 0003). */
export function customerRow(overrides = {}) {
  return {
    id: CUSTOMER_ID,
    email: 'test.customer@cpse.local',
    full_name: 'Test Customer',
    phone: '+919876543210',
    avatar_url: null,
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

export const seedCustomer = (overrides = {}) => insert('customers', customerRow(overrides));

/** A stores row (migrations 0004 + 0019). */
export function storeRow(overrides = {}) {
  return {
    id: STORE_ID,
    slug: 'sharma-kirana',
    name: 'Sharma Kirana Store',
    description: 'Neighbourhood grocery.',
    logo_url: 'https://images.cpse.local/logo.png',
    cover_image_url: null,
    phone: '+919812345601',
    email: 'hello@sharmakirana.local',
    address_line1: '14 Model Town Road',
    address_line2: null,
    city: 'Ludhiana',
    state: 'Punjab',
    postal_code: '141002',
    country: 'IN',
    latitude: '30.900965',
    longitude: '75.857276',
    opening_hours: {
      mon: [{ open: '09:00', close: '21:00' }],
      tue: [{ open: '09:00', close: '21:00' }],
      wed: [{ open: '09:00', close: '21:00' }],
      thu: [{ open: '09:00', close: '21:00' }],
      fri: [{ open: '09:00', close: '21:00' }],
      sat: [{ open: '09:00', close: '21:00' }],
      sun: [],
    },
    timezone: 'Asia/Kolkata',
    pickup_enabled: true,
    delivery_enabled: true,
    min_order_paise: 19900,
    delivery_fee_paise: 2900,
    is_active: true,
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

export const seedStore = (overrides = {}) => insert('stores', storeRow(overrides));

export function seedCategory(overrides = {}) {
  return insert('categories', {
    id: CATEGORY_ID,
    store_id: STORE_ID,
    name: 'Staples',
    slug: 'staples',
    sort_order: 1,
    is_active: true,
    ...overrides,
  });
}

export function seedProduct(overrides = {}) {
  return insert('products', {
    id: `31111111-1111-4111-8111-${String(rowsOf('products').length + 1).padStart(12, '0')}`,
    store_id: STORE_ID,
    category_id: CATEGORY_ID,
    name: 'Basmati Rice',
    slug: 'basmati-rice',
    description: 'Aged long-grain basmati.',
    price_paise: 12900,
    mrp_paise: 15000,
    is_available: true,
    stock: 40,
    sort_order: rowsOf('products').length + 1,
    ...overrides,
  });
}

export function seedProductImage(overrides = {}) {
  return insert('product_images', {
    id: `61111111-1111-4111-8111-${String(rowsOf('product_images').length + 1).padStart(12, '0')}`,
    product_id: null,
    url: 'https://images.cpse.local/product.jpg',
    alt_text: null,
    sort_order: 1,
    ...overrides,
  });
}

export function seedProductVariant(overrides = {}) {
  return insert('product_variants', {
    id: nextId('5'),
    product_id: null,
    name: '1 kg',
    price_paise: 12900,
    stock: 10,
    is_available: true,
    sort_order: rowsOf('product_variants').length + 1,
    ...overrides,
  });
}

export function seedNotification(overrides = {}) {
  return insert('notifications', {
    id: nextId('a'),
    customer_id: CUSTOMER_ID,
    type: 'order_status_changed',
    title: 'Order CPSE-0001: accepted by the store',
    body: 'The store has accepted your order.',
    payload: {},
    read_at: null,
    created_at: '2026-09-18T10:00:00.000Z',
    ...overrides,
  });
}

export function seedKhataAccount(overrides = {}) {
  return insert('khata_accounts', {
    id: nextId('b'),
    customer_id: CUSTOMER_ID,
    store_id: STORE_ID,
    balance_paise: 0,
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    ...overrides,
  });
}

/**
 * Mirrors the real trigger (migration 0017): inserting a transaction moves the
 * account balance. Without this the mock would let a test assert a balance the
 * database would never produce.
 */
export function seedKhataTransaction(overrides = {}) {
  const row = insert('khata_transactions', {
    id: nextId('c'),
    account_id: null,
    type: 'debit',
    amount_paise: 10000,
    description: null,
    order_id: null,
    occurred_at: '2026-09-10T10:00:00.000Z',
    created_at: '2026-09-10T10:00:00.000Z',
    ...overrides,
  });

  const account = (db.tables.get('khata_accounts') ?? []).find((a) => a.id === row.account_id);
  if (account) {
    account.balance_paise += row.type === 'debit' ? row.amount_paise : -row.amount_paise;
  }
  return row;
}

export function seedSavedStore(overrides = {}) {
  return insert('saved_stores', {
    customer_id: CUSTOMER_ID,
    store_id: STORE_ID,
    created_at: '2026-09-10T10:00:00.000Z',
    ...overrides,
  });
}

// ── Query builder ───────────────────────────────────────────────────────────

/**
 * Enough of PostgREST to run the app's queries. Chainable, and awaitable
 * directly (a list read) or through maybeSingle/single (a row read), matching
 * how supabase-js behaves.
 */
function queryBuilder(table) {
  const state = {
    mode: 'select',
    patch: null,
    rows: null,
    onConflict: null,
    filters: [],
    order: [],
    range: null,
    wantCount: false,
    returning: false,
  };

  const test = ({ op, column, value }, row) => {
    if (op === 'eq') return row[column] === value;
    if (op === 'neq') return row[column] !== value;
    if (op === 'in') return value.includes(row[column]);
    if (op === 'is') return (row[column] ?? null) === value;
    if (op === 'gte') return row[column] >= value;
    if (op === 'lte') return row[column] <= value;
    if (op === 'lt') return row[column] < value;
    if (op === 'ilike') {
      const text = row[column];
      if (typeof text !== 'string') return false;
      return text.toLowerCase().includes(String(value).toLowerCase());
    }
    if (op === 'or') return value.some((condition) => test(condition, row));
    throw new Error(`Unsupported filter "${op}"`);
  };

  const matches = (row) => state.filters.every((filter) => test(filter, row));

  /**
   * Parses PostgREST's `or=` grammar for the handful of forms we emit,
   * e.g. `name.ilike.%rice%,description.ilike.%rice%`. Escaped wildcards are
   * unescaped here so a query containing a literal `%` does not match
   * everything — which is exactly what escapeSearchTerm is there to prevent.
   */
  const parseOr = (expression) =>
    expression.split(',').map((part) => {
      const [column, op, ...rest] = part.split('.');
      const raw = rest.join('.');
      const value = op === 'ilike' ? raw.replace(/^%|%$/g, '').replace(/\\(.)/g, '$1') : raw;
      return { op, column, value };
    });

  function applyPatch(row) {
    // The real table has a trigger that always moves updated_at.
    Object.assign(row, state.patch, { updated_at: new Date().toISOString() });
    return row;
  }

  async function run({ single = false } = {}) {
    const failure =
      state.mode === 'update' ? 'failNextUpdate' :
      state.mode === 'select' ? 'failNextQuery' : 'failNextInsert';

    if (db[failure]) {
      const error = db[failure];
      db[failure] = null;
      return { data: null, error, count: null };
    }

    if (state.mode === 'insert' || state.mode === 'upsert') {
      if (db.uniqueViolationOnInsert) {
        const error = db.uniqueViolationOnInsert;
        db.uniqueViolationOnInsert = null;
        return { data: null, error, count: null };
      }

      const written = state.rows.map((row) => {
        const conflictKeys = state.onConflict?.split(',').map((key) => key.trim());
        const existing = conflictKeys
          ? rowsOf(table).find((candidate) =>
              conflictKeys.every((key) => candidate[key] === row[key]))
          : null;

        if (existing) {
          Object.assign(existing, row, { updated_at: new Date().toISOString() });
          return existing;
        }

        const created = {
          id: row.id ?? nextId(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...row,
        };
        insert(table, created);
        return created;
      });

      if (single) return { data: copy(written[0] ?? null), error: null, count: null };
      return { data: state.returning ? written.map(copy) : null, error: null, count: null };
    }

    let rows = rowsOf(table).filter(matches);

    if (state.mode === 'update') {
      const updated = rows.map(applyPatch);
      if (single) return { data: copy(updated[0] ?? null), error: null, count: null };
      return { data: state.returning ? updated.map(copy) : null, error: null, count: null };
    }

    if (state.mode === 'delete') {
      const survivors = rowsOf(table).filter((row) => !matches(row));
      db.tables.set(table, survivors);
      if (single) return { data: copy(rows[0] ?? null), error: null, count: null };
      return { data: state.returning ? rows.map(copy) : null, error: null, count: rows.length };
    }

    for (const { column, ascending } of [...state.order].reverse()) {
      rows = [...rows].sort((a, b) => {
        const left = a[column];
        const right = b[column];
        if (left === right) return 0;
        const result = left > right ? 1 : -1;
        return ascending ? result : -result;
      });
    }

    // count is the total BEFORE the range is applied, as PostgREST reports it.
    const count = state.wantCount ? rows.length : null;
    if (state.range) rows = rows.slice(state.range.from, state.range.to + 1);

    // PostgREST answers with JSON, so a caller holds a snapshot and never a
    // live reference into the table. Copying here is what makes a service that
    // reads a row, writes it, and then re-reads its own stale variable behave
    // the same in tests as in production.
    if (single) return { data: copy(rows[0] ?? null), error: null, count };
    return { data: rows.map(copy), error: null, count };
  }

  const filter = (op) => (column, value) => {
    state.filters.push({ op, column, value });
    return chain;
  };

  const chain = {
    select(_columns, options = {}) {
      if (options.count) state.wantCount = true;
      // A select() AFTER a write is PostgREST's "return the affected rows".
      if (state.mode !== 'select') state.returning = true;
      return chain;
    },
    insert(rows) {
      state.mode = 'insert';
      state.rows = Array.isArray(rows) ? rows : [rows];
      return chain;
    },
    upsert(rows, { onConflict } = {}) {
      state.mode = 'upsert';
      state.rows = Array.isArray(rows) ? rows : [rows];
      state.onConflict = onConflict ?? null;
      return chain;
    },
    update(patch) {
      state.mode = 'update';
      state.patch = patch;
      return chain;
    },
    delete() {
      state.mode = 'delete';
      return chain;
    },
    eq: filter('eq'),
    neq: filter('neq'),
    in: filter('in'),
    is: filter('is'),
    gte: filter('gte'),
    lte: filter('lte'),
    lt: filter('lt'),
    ilike: filter('ilike'),
    or(expression) {
      state.filters.push({ op: 'or', value: parseOr(expression) });
      return chain;
    },
    order(column, { ascending = true } = {}) {
      state.order.push({ column, ascending });
      return chain;
    },
    range(from, to) {
      state.range = { from, to };
      return chain;
    },
    limit(count) {
      state.range = { from: 0, to: count - 1 };
      return chain;
    },
    maybeSingle: () => run({ single: true }),
    single: () => run({ single: true }),
    // Awaiting the builder itself performs a list read.
    then: (resolve, reject) => run().then(resolve, reject),
  };

  return chain;
}

/**
 * An in-memory stand-in for the `create_order` Postgres function
 * (migration 0020), mirroring its behaviour step for step: idempotent replay,
 * order + items + history + payment intent, the stock decrement, the
 * unavailable-item failure, and the cart being checked out.
 *
 * The SQL itself lives in migrations/0020_create_order.sql and is verified
 * against the real database by running the seeded journey in Supabase; this
 * stand-in is what lets the API-level tests exercise the contract offline.
 */
export function createOrderRpc({ payload }) {
  const rows = (table) => {
    if (!db.tables.has(table)) db.tables.set(table, []);
    return db.tables.get(table);
  };

  if (payload.idempotency_key) {
    const existing = rows('orders').find(
      (order) =>
        order.customer_id === payload.customer_id &&
        order.idempotency_key === payload.idempotency_key,
    );
    if (existing) {
      return {
        data: { order_id: existing.id, order_number: existing.order_number, replayed: true },
        error: null,
      };
    }
  }

  const now = new Date().toISOString();
  const order = {
    id: nextId('0'),
    order_number: `CPSE-260918-${String(rows('orders').length + 1).padStart(6, '0')}`,
    store_id: payload.store_id,
    customer_id: payload.customer_id,
    fulfilment_mode: payload.fulfilment_mode,
    status: payload.status,
    payment_status: payload.payment_status,
    address_id: payload.address_id ?? null,
    delivery_address: payload.delivery_address ?? null,
    store_snapshot: payload.store_snapshot ?? null,
    subtotal_paise: payload.subtotal_paise,
    discount_paise: payload.discount_paise,
    delivery_fee_paise: payload.delivery_fee_paise,
    tax_paise: payload.tax_paise,
    total_paise: payload.total_paise,
    customer_note: payload.customer_note ?? null,
    cancellation_reason: null,
    idempotency_key: payload.idempotency_key ?? null,
    placed_at: now,
    completed_at: null,
    cancelled_at: null,
    created_at: now,
    updated_at: now,
  };

  // The function raises before committing anything, so nothing is written
  // until every line has passed its availability and stock check.
  const items = [];
  for (const item of payload.items) {
    const variant = item.variant_id
      ? rows('product_variants').find((row) => row.id === item.variant_id)
      : null;
    const product = rows('products').find((row) => row.id === item.product_id);
    const source = variant ?? product;

    const unavailable =
      !source ||
      !source.is_available ||
      (product && product.store_id !== payload.store_id) ||
      (source.stock !== null && source.stock !== undefined && source.stock < item.quantity);

    if (unavailable) {
      return {
        data: null,
        error: { code: 'P0001', message: `ITEM_UNAVAILABLE:${item.product_name}` },
      };
    }

    if (source.stock !== null && source.stock !== undefined) source.stock -= item.quantity;

    items.push({
      id: nextId('e'),
      order_id: order.id,
      product_id: item.product_id,
      variant_id: item.variant_id ?? null,
      product_name: item.product_name,
      variant_name: item.variant_name ?? null,
      image_url: item.image_url ?? null,
      unit_price_paise: item.unit_price_paise,
      quantity: item.quantity,
      line_total_paise: item.line_total_paise,
      created_at: new Date().toISOString(),
    });
  }

  rows('orders').push(order);
  rows('order_items').push(...items);
  rows('order_status_history').push({
    id: nextId('f'),
    order_id: order.id,
    from_status: null,
    to_status: payload.status,
    note: payload.history_note ?? null,
    changed_by: 'customer',
    created_at: now,
  });

  if (payload.payment) {
    rows('payments').push({
      id: nextId('a'),
      order_id: order.id,
      provider: payload.payment.provider,
      provider_ref: null,
      amount_paise: payload.payment.amount_paise,
      currency: payload.payment.currency ?? 'INR',
      status: payload.payment.status ?? 'pending',
      raw_payload: {},
      failure_reason: null,
      paid_at: null,
      created_at: now,
      updated_at: now,
    });
  }

  if (payload.cart_id) {
    const cart = rows('carts').find((row) => row.id === payload.cart_id);
    if (cart) cart.checked_out_at = now;
    db.tables.set(
      'cart_items',
      rows('cart_items').filter((row) => row.cart_id !== payload.cart_id),
    );
  }

  return {
    data: { order_id: order.id, order_number: order.order_number, replayed: false },
    error: null,
  };
}

/**
 * Stand-in for public.khata_statement (migration 0021): the opening balance
 * before the period, the debit and credit totals inside it, and the closing
 * balance. Implemented over the same rows the SQL would read, so a service that
 * passes the wrong account id or forgets a bound fails here too.
 */
export function khataStatementRpc({ p_account_id, p_from = null, p_to = null }) {
  const rows = (db.tables.get('khata_transactions') ?? []).filter(
    (row) => row.account_id === p_account_id,
  );

  const delta = (row) => (row.type === 'debit' ? row.amount_paise : -row.amount_paise);

  // No lower bound means nothing precedes the period, so it opens at zero.
  const opening = p_from
    ? rows.filter((row) => row.occurred_at < p_from).reduce((sum, row) => sum + delta(row), 0)
    : 0;

  const inPeriod = rows.filter(
    (row) => (!p_from || row.occurred_at >= p_from) && (!p_to || row.occurred_at <= p_to),
  );

  const debit = inPeriod
    .filter((row) => row.type === 'debit')
    .reduce((sum, row) => sum + row.amount_paise, 0);
  const credit = inPeriod
    .filter((row) => row.type === 'credit')
    .reduce((sum, row) => sum + row.amount_paise, 0);

  return {
    data: [
      {
        opening_paise: opening,
        debit_paise: debit,
        credit_paise: credit,
        closing_paise: opening + debit - credit,
        txn_count: inPeriod.length,
      },
    ],
    error: null,
  };
}

export function createSupabaseMock() {
  return {
    supabaseAdmin: {
      auth: {
        getUser: vi.fn(),
        admin: { signOut: vi.fn().mockResolvedValue({ error: null }) },
      },
      from: vi.fn((table) => {
        if (!KNOWN_TABLES.includes(table)) throw new Error(`No mock for table "${table}"`);
        return queryBuilder(table);
      }),
      // Order creation goes through a Postgres function (checklist 7.6), which
      // only Supabase can run. Here it is staged per test so the surrounding
      // contract — idempotency replay, pre-flight validation, error mapping —
      // is what gets exercised.
      rpc: vi.fn(async (name, args) => {
        if (name === 'create_order') return createOrderRpc(args);
        if (name === 'khata_statement') return khataStatementRpc(args);
        throw new Error(`No mock for RPC "${name}"`);
      }),
    },
    supabaseAnon: {
      auth: {
        signUp: vi.fn(),
        signInWithPassword: vi.fn(),
        refreshSession: vi.fn(),
        resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
      },
    },
    createUserClient: vi.fn(() => ({
      auth: { updateUser: vi.fn().mockResolvedValue({ data: { user: { id: CUSTOMER_ID } }, error: null }) },
    })),
  };
}

/** Shapes a Supabase session the way the auth server returns one. */
export function sessionFixture(overrides = {}) {
  return {
    access_token: 'access-token-abc',
    refresh_token: 'refresh-token-xyz',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 1789000000,
    ...overrides,
  };
}

/** A Supabase AuthError carries a numeric `status` alongside the message. */
export function authError(message, status = 400) {
  return Object.assign(new Error(message), { message, status, name: 'AuthApiError' });
}
