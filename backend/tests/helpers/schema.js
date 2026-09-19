/**
 * A small reader over the migration files, so the schema tests can assert
 * structural rules (every FK indexed, RLS everywhere, updated_at triggers)
 * without needing a live database.
 *
 * It is deliberately a light regex parser, not a SQL engine: the rules it
 * checks are all expressible from the DDL text, and the migrations are written
 * in one consistent style.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
);

/** Every migration, in filename order — which is also apply order. */
async function readMigrations(dir = MIGRATIONS_DIR) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (name) => ({ name, sql: await readFile(path.join(dir, name), 'utf8') })),
  );
}

const migrationsPromise = readMigrations();

export async function allSql() {
  const migrations = await migrationsPromise;
  return migrations.map((m) => m.sql).join('\n');
}

export { migrationsPromise as migrations };

/** Every `create table if not exists public.X (...)` block, keyed by table name. */
export async function tableBlocks() {
  const sql = await allSql();
  const blocks = new Map();
  const re = /create table if not exists public\.(\w+)\s*\(/g;

  let match;
  while ((match = re.exec(sql)) !== null) {
    const start = match.index + match[0].length;
    // Walk to the matching close paren so nested parens (checks, numerics)
    // do not end the block early.
    let depth = 1;
    let i = start;
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth += 1;
      else if (sql[i] === ')') depth -= 1;
      i += 1;
    }
    blocks.set(match[1], sql.slice(start, i - 1));
  }
  return blocks;
}

/** Column names of every foreign key, per table. */
export async function foreignKeys() {
  const blocks = await tableBlocks();
  const result = new Map();

  for (const [table, body] of blocks) {
    const columns = [];
    for (const line of body.split('\n')) {
      const match = /^\s*(\w+)\s+[\w().]+.*references\s+(?:public|auth)\.(\w+)\s*\([^)]*\)\s*(on delete [a-z ]+)?/i.exec(line);
      if (match) {
        columns.push({
          column: match[1],
          references: match[2],
          // Normalised, e.g. 'cascade' / 'set null' / 'restrict', or null when
          // the migration did not say — which checklist 10.6 forbids.
          onDelete: match[3] ? match[3].replace(/^on delete\s+/i, '').trim().toLowerCase() : null,
        });
      }
    }
    result.set(table, columns);
  }
  return result;
}

/** Index definitions per table: { columns: 'leading column', sql }. */
export async function indexes() {
  const sql = await allSql();
  const result = new Map();
  const re = /create (?:unique )?index if not exists \w+\s+on public\.(\w+)\s*\(([^;]*?)\)(?:\s+where[^;]*)?;/gis;

  let match;
  while ((match = re.exec(sql)) !== null) {
    const [, table, columns] = match;
    if (!result.has(table)) result.set(table, []);
    result.get(table).push({ columns: columns.trim(), sql: match[0] });
  }
  return result;
}

/** Leading column of each table's inline primary key, when it has one. */
export async function primaryKeyColumns() {
  const blocks = await tableBlocks();
  const result = new Map();

  for (const [table, body] of blocks) {
    const inline = /^\s*(\w+)\s+[\w().]+\s+primary key/im.exec(body);
    if (inline) {
      result.set(table, [inline[1]]);
      continue;
    }
    const composite = /primary key\s*\(([^)]+)\)/i.exec(body);
    if (composite) result.set(table, composite[1].split(',').map((c) => c.trim()));
  }
  return result;
}
