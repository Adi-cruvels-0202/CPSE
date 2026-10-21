/**
 * A supabase-js stand-in that runs every query against a real Postgres.
 *
 * supabaseMock.js re-implements each SQL function in JavaScript, which is fast
 * but can only ever be as right as the copy. This adapter instead translates
 * the PostgREST subset the API uses — select/insert/update/delete/upsert with
 * eq/neq/in/gte/lte/gt/lt/is/ilike/or/match, order/range/limit, single and
 * maybeSingle, count — into SQL and runs it on PGlite with every migration
 * applied. `rpc()` calls the real function. So an integration test exercises
 * the HTTP route, the service, the SQL functions, the triggers and the
 * constraints together.
 *
 * Rows come back through to_jsonb(), which renders timestamps, numerics, dates
 * and jsonb the way PostgREST does on the wire.
 *
 * PGlite has one connection, so two "simultaneous" requests are serialised.
 * A concurrency test here proves the second caller is refused by the same
 * row-locked check; it cannot reproduce true interleaving.
 *
 * Auth: a bearer token of the form `user:<uuid>` is a valid session for that
 * auth.users row. Nothing else is.
 *
 *   vi.mock('../../src/lib/supabase.js', async () => {
 *     const { createPgSupabase } = await import('../helpers/pgSupabase.js');
 *     return createPgSupabase();
 *   });
 */
import { randomUUID } from 'node:crypto';
import { freshDatabase, migrate } from './pgdb.js';

let dbPromise = null;
const columnTypes = new Map();
const functionShapes = new Map();

/** One migrated database per test file (vitest isolates modules per file). */
export function database() {
  if (!dbPromise) dbPromise = freshDatabase().then((db) => migrate(db));
  return dbPromise;
}

const quoteIdent = (name) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
};

async function typesOf(table) {
  if (columnTypes.has(table)) return columnTypes.get(table);
  const db = await database();
  const { rows } = await db.query(
    `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = $1 and a.attnum > 0 and not a.attisdropped`,
    [table],
  );
  if (rows.length === 0) throw new Error(`No table public.${table}`);
  const types = new Map(rows.map((row) => [row.name, row.type.replace(/\(.*\)/, '')]));
  columnTypes.set(table, types);
  return types;
}

/** Postgres errors, shaped like PostgREST's error body. */
const pgError = (error) => ({
  code: error.code ?? 'XX000',
  message: error.message,
  details: error.detail ?? null,
  hint: error.hint ?? null,
});

function serialise(value, type) {
  if (value === null || value === undefined) return null;
  if (type === 'jsonb' || type === 'json') return JSON.stringify(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    // Postgres array literal; elements here are uuids, text or numbers.
    return `{${value.map((item) => (item === null ? 'NULL' : `"${String(item).replace(/(["\\])/g, '\\$1')}"`)).join(',')}}`;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

class Params {
  constructor() {
    this.values = [];
  }

  add(value, type) {
    this.values.push(serialise(value, type));
    return `$${this.values.length}::${type ?? 'text'}`;
  }
}

function splitTopLevel(expression) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of expression) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  parts.push(current);
  return parts;
}

function parseOrFilter(expression, types, params) {
  // "name.ilike.%x%,id.in.(a,b)" — commas separate conditions except inside
  // an in-list, as in PostgREST.
  const parts = splitTopLevel(expression).map((part) => {
    const [column, operator, ...rest] = part.split('.');
    const value = rest.join('.');
    return condition(column, operator, value, types, params);
  });
  return `(${parts.join(' or ')})`;
}

function condition(column, operator, value, types, params) {
  const col = quoteIdent(column);
  const type = types.get(column);
  if (!type) throw new Error(`Unknown column ${column}`);
  // supabase-js .not(column, op, value): the same condition, negated.
  if (operator.startsWith('not.')) return `not (${condition(column, operator.slice(4), value, types, params)})`;
  switch (operator) {
    case 'eq':
      return `${col} = ${params.add(value, type)}`;
    case 'neq':
      return `${col} is distinct from ${params.add(value, type)}`;
    case 'gt':
      return `${col} > ${params.add(value, type)}`;
    case 'gte':
      return `${col} >= ${params.add(value, type)}`;
    case 'lt':
      return `${col} < ${params.add(value, type)}`;
    case 'lte':
      return `${col} <= ${params.add(value, type)}`;
    case 'ilike':
      return `${col}::text ilike ${params.add(value, 'text')}`;
    case 'like':
      return `${col}::text like ${params.add(value, 'text')}`;
    case 'is':
      if (value === null || value === 'null') return `${col} is null`;
      if (value === true || value === 'true') return `${col} is true`;
      if (value === false || value === 'false') return `${col} is false`;
      throw new Error(`Unsupported is(${value})`);
    case 'in': {
      const list = Array.isArray(value) ? value : String(value).replace(/^\(|\)$/g, '').split(',');
      if (list.length === 0) return 'false';
      return `${col} in (${list.map((item) => params.add(item, type)).join(', ')})`;
    }
    case 'cs':
      return `${col} @> ${params.add(value, type)}`;
    default:
      throw new Error(`Unsupported operator ${operator}`);
  }
}

function parseColumns(spec, types) {
  const text = (spec ?? '*').trim();
  if (text === '*' || text === '') return '*';
  const columns = text
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean);
  for (const column of columns) {
    if (!types.has(column)) throw new Error(`Unknown column ${column} in select`);
  }
  return columns.map(quoteIdent).join(', ');
}

class QueryBuilder {
  constructor(table) {
    this.table = table;
    this.action = 'select';
    this.columns = '*';
    this.returning = null;
    this.filters = [];
    this.orders = [];
    this.rangeFrom = null;
    this.rangeTo = null;
    this.limitCount = null;
    this.countMode = null;
    this.head = false;
    this.cardinality = 'many';
    this.payload = null;
    this.upsertOptions = null;
  }

  select(columns = '*', options = {}) {
    if (this.action === 'select') {
      this.columns = columns;
      this.countMode = options.count ?? null;
      this.head = Boolean(options.head);
    } else {
      this.returning = columns;
    }
    return this;
  }

  insert(rows) {
    this.action = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows, options = {}) {
    this.action = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.upsertOptions = options;
    return this;
  }

  update(patch) {
    this.action = 'update';
    this.payload = patch;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  filterOn(column, operator, value) {
    this.filters.push({ column, operator, value });
    return this;
  }

  eq(column, value) {
    return this.filterOn(column, 'eq', value);
  }
  neq(column, value) {
    return this.filterOn(column, 'neq', value);
  }
  gt(column, value) {
    return this.filterOn(column, 'gt', value);
  }
  gte(column, value) {
    return this.filterOn(column, 'gte', value);
  }
  lt(column, value) {
    return this.filterOn(column, 'lt', value);
  }
  lte(column, value) {
    return this.filterOn(column, 'lte', value);
  }
  in(column, values) {
    return this.filterOn(column, 'in', values);
  }
  is(column, value) {
    return this.filterOn(column, 'is', value);
  }
  ilike(column, value) {
    return this.filterOn(column, 'ilike', value);
  }
  like(column, value) {
    return this.filterOn(column, 'like', value);
  }
  contains(column, value) {
    return this.filterOn(column, 'cs', value);
  }
  match(object) {
    for (const [column, value] of Object.entries(object)) this.eq(column, value);
    return this;
  }
  or(expression) {
    this.filters.push({ or: expression });
    return this;
  }
  filter(column, operator, value) {
    return this.filterOn(column, operator, value);
  }
  not(column, operator, value) {
    return this.filterOn(column, `not.${operator}`, value);
  }

  order(column, { ascending = true, nullsFirst } = {}) {
    this.orders.push({ column, ascending, nullsFirst });
    return this;
  }

  range(from, to) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  limit(count) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.cardinality = 'single';
    return this;
  }

  maybeSingle() {
    this.cardinality = 'maybe';
    return this;
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  where(types, params) {
    if (this.filters.length === 0) return '';
    const parts = this.filters.map((filter) =>
      filter.or !== undefined
        ? parseOrFilter(filter.or, types, params)
        : condition(filter.column, filter.operator, filter.value, types, params),
    );
    return ` where ${parts.join(' and ')}`;
  }

  async execute() {
    const db = await database();
    const types = await typesOf(this.table);
    const params = new Params();
    const table = `public.${quoteIdent(this.table)}`;
    let sql;
    let countSql = null;
    let countParams = null;

    try {
      if (this.action === 'select') {
        const where = this.where(types, params);
        const orderBy = this.orders.length
          ? ` order by ${this.orders
              .map(
                ({ column, ascending, nullsFirst }) =>
                  `${quoteIdent(column)} ${ascending ? 'asc' : 'desc'}${
                    nullsFirst === undefined ? '' : nullsFirst ? ' nulls first' : ' nulls last'
                  }`,
              )
              .join(', ')}`
          : '';
        let window = '';
        if (this.rangeFrom !== null) window = ` limit ${this.rangeTo - this.rangeFrom + 1} offset ${this.rangeFrom}`;
        else if (this.limitCount !== null) window = ` limit ${Number(this.limitCount)}`;
        const columns = parseColumns(this.columns, types);
        sql = `select to_jsonb(t) as row from (select ${columns} from ${table}${where}${orderBy}${window}) t`;
        if (this.countMode) {
          countSql = `select count(*)::int as n from ${table}${where}`;
          countParams = [...params.values];
        }
      } else if (this.action === 'insert' || this.action === 'upsert') {
        const columns = [...new Set(this.payload.flatMap((row) => Object.keys(row)))];
        const values = this.payload
          .map(
            (row) =>
              `(${columns
                .map((column) => (column in row ? params.add(row[column], types.get(column)) : 'default'))
                .join(', ')})`,
          )
          .join(', ');
        sql = `insert into ${table} (${columns.map(quoteIdent).join(', ')}) values ${values}`;
        if (this.action === 'upsert') {
          const target = (this.upsertOptions.onConflict ?? 'id').split(',').map((c) => quoteIdent(c.trim()));
          sql += this.upsertOptions.ignoreDuplicates
            ? ` on conflict (${target.join(', ')}) do nothing`
            : ` on conflict (${target.join(', ')}) do update set ${columns
                .map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`)
                .join(', ')}`;
        }
        sql = `with t as (${sql} returning ${parseColumns(this.returning ?? '*', types)}) select to_jsonb(t) as row from t`;
      } else if (this.action === 'update') {
        const sets = Object.entries(this.payload)
          .map(([column, value]) => `${quoteIdent(column)} = ${params.add(value, types.get(column))}`)
          .join(', ');
        const where = this.where(types, params);
        sql = `with t as (update ${table} set ${sets}${where} returning ${parseColumns(this.returning ?? '*', types)}) select to_jsonb(t) as row from t`;
      } else if (this.action === 'delete') {
        const where = this.where(types, params);
        sql = `with t as (delete from ${table}${where} returning ${parseColumns(this.returning ?? '*', types)}) select to_jsonb(t) as row from t`;
      }

      const { rows } = await db.query(sql, params.values);
      let data = rows.map((row) => row.row);
      let count = null;
      if (countSql) count = (await db.query(countSql, countParams)).rows[0].n;

      const returnsRows = this.action === 'select' || this.returning !== null;
      if (!returnsRows) return { data: null, error: null, count };
      if (this.head) return { data: null, error: null, count };

      if (this.cardinality === 'single') {
        if (data.length !== 1) {
          return {
            data: null,
            count,
            error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
          };
        }
        data = data[0];
      } else if (this.cardinality === 'maybe') {
        if (data.length > 1) {
          return {
            data: null,
            count,
            error: { code: 'PGRST116', message: 'JSON object requested, multiple rows returned' },
          };
        }
        data = data[0] ?? null;
      }
      return { data, error: null, count };
    } catch (error) {
      if (!error.code && !/^[A-Z_]+/.test(error.message)) throw error;
      return { data: null, error: pgError(error), count: null };
    }
  }
}

async function shapeOf(name) {
  if (functionShapes.has(name)) return functionShapes.get(name);
  const db = await database();
  const { rows } = await db.query(
    `select p.proretset as set, t.typname as returns, p.proargnames as names,
            (select array_agg(format_type(x, null)) from unnest(p.proargtypes) x) as types
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join pg_type t on t.oid = p.prorettype
      where n.nspname = 'public' and p.proname = $1`,
    [name],
  );
  if (rows.length !== 1) throw new Error(`No unique function public.${name}`);
  const shape = rows[0];
  functionShapes.set(name, shape);
  return shape;
}

async function rpc(name, args = {}) {
  const db = await database();
  const shape = await shapeOf(name);
  const params = new Params();
  const argNames = shape.names ?? [];
  const argTypes = shape.types ?? [];
  const named = Object.entries(args).map(([key, value]) => {
    const index = argNames.indexOf(key);
    if (index < 0) throw new Error(`public.${name} has no argument ${key}`);
    return `${quoteIdent(key)} => ${params.add(value, argTypes[index])}`;
  });
  const call = `public.${quoteIdent(name)}(${named.join(', ')})`;

  try {
    if (shape.set || shape.returns === 'record') {
      const { rows } = await db.query(`select to_jsonb(r) as row from ${call} r`, params.values);
      return { data: rows.map((row) => row.row), error: null };
    }
    if (shape.returns === 'void') {
      await db.query(`select ${call}`, params.values);
      return { data: null, error: null };
    }
    const { rows } = await db.query(`select to_jsonb(${call}) as value`, params.values);
    return { data: rows[0]?.value ?? null, error: null };
  } catch (error) {
    return { data: null, error: pgError(error) };
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const tokenFor = (userId) => `user:${userId}`;
export const authHeader = (userId) => ({ Authorization: `Bearer ${tokenFor(userId)}` });

async function getUser(token) {
  const match = /^user:([0-9a-f-]{36})$/.exec(token ?? '');
  if (!match) return { data: { user: null }, error: { message: 'invalid JWT', status: 401 } };
  const db = await database();
  const { rows } = await db.query('select id, email from auth.users where id = $1', [match[1]]);
  if (rows.length === 0) return { data: { user: null }, error: { message: 'user not found', status: 401 } };
  return { data: { user: { id: rows[0].id, email: rows[0].email } }, error: null };
}

/** An auth user; the 0003 trigger gives them a customers row. */
export async function createUser({ id = randomUUID(), email, fullName = 'Test User', phone = null } = {}) {
  const db = await database();
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`,
    [id, email ?? `${id.slice(0, 8)}@test.cpse.local`, JSON.stringify({ full_name: fullName, phone })],
  );
  return id;
}

/** A shop account: an auth user with a merchants row. */
export async function createMerchantUser(options = {}) {
  const id = await createUser(options);
  const db = await database();
  await db.query(`insert into public.merchants (id, email, full_name) select id, email, full_name from public.customers where id = $1`, [id]);
  return id;
}

// ── Storage ──────────────────────────────────────────────────────────────────

export const storage = new Map();

function storageBucket(bucket) {
  return {
    upload: async (path, body, options = {}) => {
      storage.set(`${bucket}/${path}`, { body, contentType: options.contentType ?? null });
      return { data: { path }, error: null };
    },
    remove: async (paths) => {
      for (const path of paths) storage.delete(`${bucket}/${path}`);
      return { data: paths.map((name) => ({ name })), error: null };
    },
    download: async (path) => {
      const file = storage.get(`${bucket}/${path}`);
      if (!file) return { data: null, error: { message: 'Object not found', statusCode: '404' } };
      return { data: new Blob([file.body], { type: file.contentType ?? 'application/octet-stream' }), error: null };
    },
    createSignedUrl: async (path, expiresIn) => ({
      data: { signedUrl: `https://storage.test/storage/v1/object/sign/${bucket}/${path}?expires=${expiresIn}` },
      error: null,
    }),
    getPublicUrl: (path) => ({
      data: { publicUrl: `https://storage.test/storage/v1/object/public/${bucket}/${path}` },
    }),
  };
}

// ── Data reset ───────────────────────────────────────────────────────────────

/** Empties every table, keeping the schema. Fast enough to run before each test. */
export async function resetDatabase() {
  const db = await database();
  const { rows } = await db.query(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = rows.map((row) => `public.${quoteIdent(row.tablename)}`);
  await db.exec(`truncate ${[...tables, 'auth.users'].join(', ')} restart identity cascade`);
  storage.clear();
}

/** Raw SQL, for arranging data and for asserting on what was written. */
export async function sql(text, params = []) {
  const db = await database();
  return (await db.query(text, params)).rows;
}

export function createPgSupabase() {
  const client = {
    from: (table) => new QueryBuilder(table),
    rpc,
    auth: {
      getUser,
      admin: { signOut: async () => ({ error: null }) },
    },
    storage: { from: (bucket) => storageBucket(bucket) },
  };
  return {
    supabaseAdmin: client,
    supabaseAnon: {
      auth: {
        signUp: async () => ({ data: null, error: { message: 'not available in integration tests' } }),
        signInWithPassword: async () => ({ data: null, error: { message: 'not available in integration tests' } }),
        refreshSession: async () => ({ data: null, error: { message: 'not available in integration tests' } }),
        resetPasswordForEmail: async () => ({ data: {}, error: null }),
      },
    },
    createUserClient: () => client,
  };
}
