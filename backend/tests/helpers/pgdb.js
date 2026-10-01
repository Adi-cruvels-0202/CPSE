/**
 * A real Postgres for the SQL that the Supabase mock can only imitate.
 *
 * PGlite is Postgres compiled to WebAssembly: no server, no Docker, no network.
 * The migrations are applied to it exactly as written, so create_order, the
 * stock triggers and the one-time backfills are tested as SQL, not as the
 * JavaScript stand-in in supabaseMock.js.
 *
 * Supabase provides an `auth` schema and three roles that the migrations refer
 * to; the minimum of each is created here first.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

const SUPABASE_STANDINS = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
`;

async function migrationFiles() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (name) => ({
      name,
      // gen_random_uuid() is built into Postgres 13+, so pgcrypto is not needed.
      sql: (await readFile(path.join(MIGRATIONS_DIR, name), 'utf8')).replace(
        /create extension if not exists "pgcrypto";.*\n/,
        '',
      ),
    })),
  );
}

/** A fresh database with the Supabase stand-ins and no migrations applied. */
export async function freshDatabase() {
  const db = new PGlite({ extensions: { citext } });
  await db.exec(SUPABASE_STANDINS);
  return db;
}

/**
 * Applies every migration whose number is in [from, to], in order. Lets a test
 * stop before a migration, write data in the old shape, then run the rest.
 */
export async function migrate(db, { from = 1, to = Infinity } = {}) {
  for (const { name, sql } of await migrationFiles()) {
    const number = Number(name.slice(0, 4));
    if (number >= from && number <= to) await db.exec(sql);
  }
  return db;
}

/** First row of a query, for terse assertions. */
export const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
