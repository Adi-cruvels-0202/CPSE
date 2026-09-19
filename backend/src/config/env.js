import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Every environment variable the backend reads is declared here.
 * Nothing else in the codebase touches `process.env` directly — import `env` instead.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  // Supabase — the shared auth + database platform (see PROJECT_CONTEXT.md D1)
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Comma-separated list of origins allowed to call the API.
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // Where Supabase sends the customer after they click the password-reset link.
  // Must also be listed in the Supabase dashboard's redirect allowlist.
  PASSWORD_RESET_REDIRECT_URL: z.string().url().default('http://localhost:5173/reset-password'),

  // Payments (decision D7). The provider is swappable; `mock` is the only one
  // implemented until a real gateway is chosen.
  PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
  // Signs and verifies payment webhooks. Must match what the gateway holds.
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).default('dev-only-webhook-secret-change-me'),
  PAYMENT_MOCK_CHECKOUT_URL: z.string().url().default('http://localhost:5173/mock-payment'),

  // Exposes the test-only endpoint that advances an order's status the way a
  // merchant dashboard would (checklist 8.8). MUST stay false in production.
  ENABLE_TEST_ENDPOINTS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  // Checklist 10.7. Writes that cost work (order creation, payment initiation)
  // and webhook deliveries are metered separately from ordinary reads.
  WRITE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  // Largest request body accepted. A cart line, an address or an order is a few
  // hundred bytes; the cap is what stops a body being used as a memory bill.
  JSON_BODY_LIMIT: z.string().trim().min(2).default('32kb'),
});

/**
 * In `test` we allow placeholder Supabase credentials so the suite can run
 * without a live project. Real credentials are required everywhere else.
 */
function testDefaults(source) {
  if (source.NODE_ENV !== 'test') return source;
  return {
    ...source,
    SUPABASE_URL: source.SUPABASE_URL ?? 'http://localhost:54321',
    SUPABASE_ANON_KEY: source.SUPABASE_ANON_KEY ?? 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role-key',
    LOG_LEVEL: source.LOG_LEVEL ?? 'silent',
    // The order lifecycle cannot be tested without a way to advance it.
    ENABLE_TEST_ENDPOINTS: source.ENABLE_TEST_ENDPOINTS ?? 'true',
  };
}

export function loadEnv(source = process.env) {
  const parsed = envSchema.safeParse(testDefaults(source));

  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${missing}\n\n` +
        'Copy backend/.env.example to backend/.env and fill in the values.',
    );
  }

  const value = parsed.data;

  // A production deployment that leaves the test-only status endpoint on would
  // let anyone march someone else's order to 'completed'.
  if (value.NODE_ENV === 'production' && value.ENABLE_TEST_ENDPOINTS) {
    throw new Error('ENABLE_TEST_ENDPOINTS must not be true in production.');
  }

  return {
    ...value,
    isProduction: value.NODE_ENV === 'production',
    isTest: value.NODE_ENV === 'test',
    corsOrigins: value.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

export const env = loadEnv();
