/**
 * Prints every migration as one SQL script, for pasting into the Supabase SQL
 * editor when there is no DATABASE_URL to hand.
 *
 *   npm run db:print > schema.sql
 */
import { readMigrations } from './migrate.js';

const migrations = await readMigrations();
for (const { name, sql } of migrations) {
  console.log(`-- ==========================================================`);
  console.log(`-- ${name}`);
  console.log(`-- ==========================================================`);
  console.log(sql.trimEnd());
  console.log('');
}
