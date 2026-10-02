import { defineWorkspace } from 'vitest/config';
import base from './vitest.config.js';

/**
 * Two kinds of test, run differently.
 *
 *   api — everything against the in-memory Supabase mock. Light; runs in
 *         parallel across files.
 *   sql — the migrations run on real Postgres compiled to WebAssembly (PGlite).
 *         Each file starts its own database, which is CPU- and memory-heavy;
 *         several at once beside the api files made a random one time out now
 *         and then. One process, one file at a time, keeps them steady.
 *
 * Built from the base settings by hand rather than with `extends`, which
 * concatenates `include` lists instead of replacing them.
 */
const SQL_TESTS = 'tests/*Sql.test.js';
const { coverage, ...shared } = base.test;

export default defineWorkspace([
  {
    test: { ...shared, name: 'api', include: ['tests/**/*.test.js'], exclude: [SQL_TESTS, 'node_modules/**'] },
  },
  {
    test: {
      ...shared,
      name: 'sql',
      include: [SQL_TESTS],
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      testTimeout: 60_000,
    },
  },
]);
