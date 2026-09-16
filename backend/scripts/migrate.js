/**
 * Migration runner — applies backend/migrations/*.sql in filename order.
 *
 *   npm run db:migrate            apply everything pending
 *   npm run db:migrate -- --dry   list what would run, change nothing
 *   npm run db:print              concatenate every migration to stdout, for
 *                                 pasting into the Supabase SQL editor
 *
 * Needs DATABASE_URL (Supabase dashboard -> Project Settings -> Database ->
 * Connection string). Each file runs inside its own transaction and is recorded
 * in public.schema_migrations, so re-running is a no-op. Every migration is
 * also written to be idempotent on its own (`if not exists`, `or replace`).
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../src/config/env.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function readMigrations(dir = MIGRATIONS_DIR) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(path.join(dir, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

/** TLS for remote databases, plaintext for a local one. */
export function sslFor(connectionString) {
  const { hostname } = new URL(connectionString);
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  return isLocal ? false : { rejectUnauthorized: false };
}

const LEDGER = `
  create table if not exists public.schema_migrations (
    name        text primary key,
    checksum    text not null,
    applied_at  timestamptz not null default now()
  );
  -- No policies: with RLS on, anon and authenticated can read nothing. The
  -- runner itself connects as the database owner and bypasses this.
  alter table public.schema_migrations enable row level security;
`;

async function migrate({ dryRun }) {
  const migrations = await readMigrations();
  if (migrations.length === 0) throw new Error(`No .sql files found in ${MIGRATIONS_DIR}`);

  if (!env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set.\n' +
        '  Supabase dashboard -> Project Settings -> Database -> Connection string\n' +
        '  (use the "Session pooler" URI and put your database password in it),\n' +
        '  then add it to backend/.env.\n' +
        '  Alternatively run `npm run db:print` and paste the output into the SQL editor.',
    );
  }

  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    // Supabase terminates TLS with its own CA; the connection is encrypted but
    // the chain is not verifiable from here. A local Postgres (supabase start,
    // or a throwaway cluster) speaks plaintext, so only ask for TLS remotely.
    ssl: sslFor(env.DATABASE_URL),
  });
  await client.connect();

  try {
    await client.query(LEDGER);
    const { rows } = await client.query('select name, checksum from public.schema_migrations');
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));

    for (const migration of migrations) {
      const previous = applied.get(migration.name);

      if (previous === migration.checksum) {
        console.log(`  = ${migration.name} (already applied)`);
        continue;
      }
      if (previous) {
        // Editing an applied migration means the database and the repo disagree
        // about what the schema is. Fail rather than guess.
        throw new Error(
          `${migration.name} has changed since it was applied.\n` +
            '  Add a new migration instead of editing an applied one.',
        );
      }
      if (dryRun) {
        console.log(`  + ${migration.name} (pending)`);
        continue;
      }

      process.stdout.write(`  + ${migration.name} ... `);
      await client.query('begin');
      try {
        await client.query(migration.sql);
        await client.query(
          'insert into public.schema_migrations (name, checksum) values ($1, $2)',
          [migration.name, migration.checksum],
        );
        await client.query('commit');
        console.log('ok');
      } catch (error) {
        await client.query('rollback');
        console.log('failed');
        throw error;
      }
    }

    console.log(dryRun ? 'Dry run complete — nothing was applied.' : 'Migrations up to date.');
  } finally {
    await client.end();
  }
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const dryRun = process.argv.includes('--dry') || process.argv.includes('--dry-run');
  migrate({ dryRun }).catch((error) => {
    console.error(`\nMigration failed: ${error.message}`);
    process.exit(1);
  });
}
