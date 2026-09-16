import { vi } from 'vitest';

/**
 * A stand-in for src/lib/supabase.js.
 *
 * The auth calls are plain spies that each test stages, because what matters
 * there is how we translate Supabase's replies. `from('customers')` instead
 * runs against a small in-memory table, so tests can seed a profile row and
 * read the real update semantics back — a spy returning a fixed object would
 * not catch a handler that patches the wrong column.
 *
 * Used through `vi.mock`, which hoists above imports:
 *
 *   vi.mock('../src/lib/supabase.js', async () => {
 *     const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
 *     return createSupabaseMock();
 *   });
 */

export const db = {
  /** id -> customers row */
  customers: new Map(),
  /** Set to force the next customers read to fail. */
  failNextQuery: null,
  /** Set to force the next customers update to fail. */
  failNextUpdate: null,
};

export const CUSTOMER_ID = '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e12';

/** A complete customers row, matching the columns migration 0003 declares. */
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

export function seedCustomer(overrides = {}) {
  const row = customerRow(overrides);
  db.customers.set(row.id, row);
  return row;
}

export function resetDb() {
  db.customers.clear();
  db.failNextQuery = null;
  db.failNextUpdate = null;
}

/** Minimal PostgREST-style query builder over the in-memory customers table. */
function customersQuery() {
  const chain = {
    _mode: 'select',
    _patch: null,
    _filters: [],

    select() {
      return chain;
    },
    update(patch) {
      chain._mode = 'update';
      chain._patch = patch;
      return chain;
    },
    eq(column, value) {
      chain._filters.push([column, value]);
      return chain;
    },
    maybeSingle() {
      return chain._run();
    },
    single() {
      return chain._run();
    },

    async _run() {
      // Reads and writes fail independently, so a test can break the update
      // without also breaking the profile load that requireAuth does first.
      const failure = chain._mode === 'update' ? 'failNextUpdate' : 'failNextQuery';
      if (db[failure]) {
        const error = db[failure];
        db[failure] = null;
        return { data: null, error };
      }

      const rows = [...db.customers.values()].filter((row) =>
        chain._filters.every(([column, value]) => row[column] === value),
      );
      const row = rows[0] ?? null;

      if (chain._mode === 'update') {
        if (!row) return { data: null, error: null };
        // The real table has a trigger that always moves updated_at.
        const updated = { ...row, ...chain._patch, updated_at: new Date().toISOString() };
        db.customers.set(row.id, updated);
        return { data: updated, error: null };
      }

      return { data: row, error: null };
    },
  };

  return chain;
}

export function createSupabaseMock() {
  return {
    supabaseAdmin: {
      auth: {
        getUser: vi.fn(),
        admin: { signOut: vi.fn().mockResolvedValue({ error: null }) },
      },
      from: vi.fn((table) => {
        if (table !== 'customers') throw new Error(`No mock for table "${table}"`);
        return customersQuery();
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
