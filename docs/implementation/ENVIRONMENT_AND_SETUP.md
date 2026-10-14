# Environment and setup

How to run what is on `feature/roadmap-completion`, locally and in production.
Values are never written here — only the names of the settings and where they
come from.

## Requirements

- Node 20 or newer, npm.
- A Supabase project (Postgres + auth). Nothing else is required: there is no
  separate database, queue or cache.

## Database

Apply `backend/migrations/*.sql` in filename order (`0001` … `0044`) in the
Supabase SQL editor. Every file is idempotent. This branch adds **0036–0044**:

| File | Adds |
|---|---|
| `0036_payment_method_and_notifications.sql` | payment method on orders, customer and merchant notifications, delivery records |
| `0037_khata_merchant_ledger.sql` | merchant-run khata ledger, reversals, reminders, khata at checkout |
| `0038_refunds.sql` | refunds and refund events, opened by trigger on paid cancellations |
| `0039_store_verification.sql` | store verification (KYC), documents bucket, platform admins, publish gate |
| `0040_merchant_operations.sql` | store defaults, category order/delete, suppliers, purchases, batches (FEFO), barcode uniqueness |
| `0041_customer_relationship.sql` | consent per store, activity events, favourites, lists and templates |
| `0042_loyalty_coupons_offers.sql` | loyalty programmes, ledger, rewards, coupons, local offers, order benefits |
| `0043_messaging_substitutions_jobs.sql` | conversations, messages, announcements, substitutions, job leases and runs, recurring tasks, reminders |
| `0044_cart_behaviour_events.sql` | `cart_abandon` event type and a unique `dedupe_key` on behaviour events |

A deployment that already has 0001–0035 needs only 0036–0044, in order.

Platform reviewers (store verification, escalated support) are rows in
`platform_admins`, inserted in the SQL editor for an existing auth user:
`insert into platform_admins (id, email) values ('<auth user id>', '<email>');`
They sign in at `/merchant/admin`.

## Backend settings (`backend/.env`, from `backend/.env.example`)

| Setting | Purpose | Default |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | the project (service-role key is server-side only) | required |
| `PORT` | one port serves the API and both apps | 4000 |
| `CORS_ORIGINS` | only for a frontend served elsewhere | — |
| `PASSWORD_RESET_REDIRECT_URL` | must also be an allowed redirect in Supabase | `http://localhost:4000/reset-password` |
| `PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET`, `PAYMENT_MOCK_CHECKOUT_URL` | `mock` is the only provider implemented | mock |
| `JOBS_ENABLED`, `JOBS_INTERVAL_SECONDS` | in-process scheduler (leases make several instances safe) | true, 60 |
| `PUBLIC_APP_URL` | absolute links and QR codes | `http://localhost:4000` |
| `NOTIFY_CHANNEL_PROVIDER` (`none`\|`webhook`), `NOTIFY_WEBHOOK_URL`, `NOTIFY_WEBHOOK_SECRET` | SMS/WhatsApp/email; `none` records attempts as skipped | none |
| `AI_PROVIDER` (`none`\|`gemini`) | photo reading only: product recognition and invoice photos/PDFs. Everything else in intelligence is deterministic. With `none` those two endpoints answer 503 | none |
| `GEMINI_API_KEY` | Google AI Studio key, server-side only; required when `AI_PROVIDER=gemini` | — |
| `AI_MODEL`, `AI_FALLBACK_MODEL` | the vision model, and the one tried when the first is busy or fails transiently | `gemini-flash-lite-latest`, `gemini-3.5-flash-lite` |
| `AI_TIMEOUT_MS` | per model call | 30000 |

Without `JOBS_ENABLED`, run `npm run db:maintenance` from cron (every few
minutes) — it runs every job once: unpaid-order expiry, refund reconciliation,
offer expiry, low-stock and expiry alerts, recurring tasks, reorder and
khata reminders, points expiry, support escalation, abandoned-cart events and
notification deliveries.

## Running

```bash
cd backend && npm install && npm run dev
```

The backend serves the API at `/api/v1`, the customer app at `/` and the
merchant app at `/merchant` (with Vite in development). `npm run build` in
`backend/` builds both apps for production; `npm start` serves them.

## Tests (no Supabase needed)

```bash
cd backend && npx vitest run            # api + sql + integration (PGlite, every migration)
cd frontend/customer && npx vitest run
cd frontend/merchant && npx vitest run && npx tsc -b
```

## What needs credentials this environment does not have

- **Supabase project** — for running the stack and a browser end-to-end pass (matrix C-23).
- **Payment gateway** — only the mock provider exists (C-13, C-56).
- **SMS / WhatsApp / email vendor** — set `NOTIFY_CHANNEL_PROVIDER=webhook` and point it at a gateway.
- **Supabase project that exists** — the URL supplied for this branch does not resolve, so C-23 could not run.

## Photo reading (Gemini)

`src/lib/ai.js` is the only code that calls the model (official `@google/genai`
SDK). Photos are re-encoded to a JPEG of at most 1280 px before sending, which
also drops EXIF (location, device); PDFs are sent as they are. The model
answers in a fixed JSON schema; the server validates it, matches it to the
shop's own records and returns a proposal — nothing is written. Each photo is
one model call (about 2–3 s in the live checks). Tests never call the real
model: `tests/setup.js` forces `AI_PROVIDER=none` and tests script answers with
`setVisionProviderForTests()`.
