import { describe, it, expect } from 'vitest';
import { readMigrations } from '../scripts/migrate.js';

describe('readMigrations', () => {
  it('returns every .sql file in filename order', async () => {
    const migrations = await readMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(18);
    const names = migrations.map((m) => m.name);
    expect(names).toEqual([...names].sort());
    expect(names.every((name) => name.endsWith('.sql'))).toBe(true);
  });

  it('checksums content, so an edited-after-apply migration can be detected', async () => {
    const [first] = await readMigrations();
    expect(first.checksum).toMatch(/^[0-9a-f]{64}$/);

    // Stable across reads — the runner compares this against the ledger.
    const [again] = await readMigrations();
    expect(again.checksum).toBe(first.checksum);
  });

  it('loads non-empty SQL for every file', async () => {
    for (const { name, sql } of await readMigrations()) {
      expect(sql.trim().length, `${name} is empty`).toBeGreaterThan(0);
    }
  });
});
