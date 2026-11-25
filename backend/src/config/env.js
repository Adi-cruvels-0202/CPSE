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

  // Comma-separated list of *other* origins allowed to call the API. The
  // server's own origin is always allowed (see corsOptionsFor in app.js), so
  // this is only needed when the app is served from somewhere else — a
  // standalone `vite` on 5173, or a separate static host.
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // Where Supabase sends the customer after they click the password-reset link.
  // Must also be listed in the Supabase dashboard's redirect allowlist.
  PASSWORD_RESET_REDIRECT_URL: z.string().url().default('http://localhost:4000/reset-password'),

  // Payments (decision D7). The provider is swappable; `mock` is the only one
  // implemented until a real gateway is chosen.
  PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
  // Signs and verifies payment webhooks. Must match what the gateway holds.
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).default('dev-only-webhook-secret-change-me'),
  PAYMENT_MOCK_CHECKOUT_URL: z.string().url().default('http://localhost:4000/mock-payment'),
  // How the MOCK provider answers a refund. 'async' accepts it as processing
  // and reports it refunded once PAYMENT_MOCK_REFUND_SETTLE_SECONDS have
  // passed (to the reconciliation job, or via a signed refund webhook) — the
  // shape a real gateway has. 'fail' declines every refund, to exercise the
  // failure path. Ignored by any real provider.
  PAYMENT_MOCK_REFUND_MODE: z.enum(['async', 'fail']).default('async'),
  PAYMENT_MOCK_REFUND_SETTLE_SECONDS: z.coerce.number().int().nonnegative().default(60),

  // Background jobs (expiry sweeps, refund reconciliation, alerts, offers,
  // recurring tasks). Off in tests; one instance should run them in production.
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  JOBS_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),

  // Serve the React app from this process too, so `npm run dev` in the backend
  // is the only thing you need to run. Set false to go back to API-only.
  SERVE_FRONTEND: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  // Serve the pre-built frontend (dist/) even in development, rather than
  // spinning up Vite dev middleware. Always true in production.
  SERVE_STATIC_FRONTEND: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

  // Absolute public URL of this deployment, for links and QR codes a merchant
  // shares. The app's own origin is used when it serves the request.
  PUBLIC_APP_URL: z.string().url().default('http://localhost:4000'),

  // SMS / WhatsApp / email delivery (src/lib/channels.js). 'none' records
  // every attempt as skipped; 'webhook' posts signed messages to a gateway.
  NOTIFY_CHANNEL_PROVIDER: z.enum(['none', 'webhook']).default('none'),
  NOTIFY_WEBHOOK_URL: z.string().url().optional(),
  NOTIFY_WEBHOOK_SECRET: z.string().min(16).default('dev-only-notify-secret-change-me'),

  // Run the shop from WhatsApp (src/modules/whatsapp, Meta's WhatsApp Cloud
  // API). 'none' keeps the feature working end to end but sends nothing: every
  // outgoing message is recorded as skipped. 'meta' needs the four values
  // below from the Meta app (WhatsApp → API setup).
  WHATSAPP_PROVIDER: z.enum(['none', 'meta']).default('none'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().trim().min(1).optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().trim().min(1).optional(),
  // Signs every webhook call (X-Hub-Signature-256); calls without it are refused.
  WHATSAPP_APP_SECRET: z.string().trim().min(8).optional(),
  // Any string you choose; Meta echoes it once when the webhook is registered.
  WHATSAPP_VERIFY_TOKEN: z.string().trim().min(8).optional(),
  // The CPSE business number shop owners message, digits with country code.
  WHATSAPP_BUSINESS_NUMBER: z.string().trim().regex(/^[1-9][0-9]{7,14}$/, 'Digits with country code, e.g. 919876543210.').optional(),
  WHATSAPP_API_VERSION: z.string().trim().regex(/^v[0-9]+\.[0-9]+$/).default('v23.0'),
  // New-order alerts outside WhatsApp's 24-hour window must use a template
  // approved in WhatsApp Manager (docs/implementation/WHATSAPP.md). Unset: such
  // alerts are recorded as skipped with that reason.
  WHATSAPP_ORDER_TEMPLATE: z.string().trim().min(1).optional(),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().trim().min(2).default('en'),

  // Intelligence (src/modules/intelligence) is deterministic and needs no
  // provider. A vision model adds two things only: recognising a product from
  // a photo and reading an invoice photo/PDF (src/lib/ai.js). 'none' turns
  // those off and they say so; 'gemini' uses Google's Gemini Developer API.
  AI_PROVIDER: z.enum(['none', 'gemini']).default('none'),
  GEMINI_API_KEY: z.string().min(1).optional(),
  // An alias that follows Google's current Flash-Lite model (fast enough for a
  // shop counter), and a pinned model tried once if the first is unavailable.
  AI_MODEL: z.string().min(1).default('gemini-flash-lite-latest'),
  AI_FALLBACK_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(2000).max(120_000).default(30_000),

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

  // Meta needs all four to send and to trust the webhook; a half-configured
  // WhatsApp would accept messages it can never answer.
  if (value.WHATSAPP_PROVIDER === 'meta') {
    const needed = ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_BUSINESS_NUMBER'];
    const absent = needed.filter((key) => !value[key]);
    if (absent.length) {
      throw new Error(`Invalid environment configuration:\n${absent.map((key) => `  - ${key}: required when WHATSAPP_PROVIDER=meta`).join('\n')}`);
    }
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
