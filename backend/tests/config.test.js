import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const validEnv = {
  NODE_ENV: 'production',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
};

describe('environment configuration', () => {
  it('accepts a complete configuration and applies defaults', () => {
    const env = loadEnv(validEnv);

    expect(env.PORT).toBe(4000);
    expect(env.isProduction).toBe(true);
    expect(env.corsOrigins).toEqual(['http://localhost:5173']);
  });

  it('fails fast when a required Supabase key is missing', () => {
    const { SUPABASE_SERVICE_ROLE_KEY, ...incomplete } = validEnv;

    expect(() => loadEnv(incomplete)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('rejects a malformed Supabase URL', () => {
    expect(() => loadEnv({ ...validEnv, SUPABASE_URL: 'not-a-url' })).toThrow(
      /SUPABASE_URL/,
    );
  });

  it('parses a comma-separated CORS origin list', () => {
    const env = loadEnv({
      ...validEnv,
      CORS_ORIGINS: 'https://a.com, https://b.com ,https://c.com',
    });

    expect(env.corsOrigins).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
  });

  it('allows placeholder credentials only in the test environment', () => {
    const env = loadEnv({ NODE_ENV: 'test' });
    expect(env.isTest).toBe(true);
    expect(env.SUPABASE_URL).toBe('http://localhost:54321');
  });
});
