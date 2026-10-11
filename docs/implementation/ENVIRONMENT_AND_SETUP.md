# Environment and setup

How to run what is on `feature/roadmap-completion`, locally and in production.
Values are never written here — only the names of the settings and where they
come from.

## Requirements

- Node 20 or newer, npm.
- A Supabase project (Postgres + auth). Nothing else is required: there is no
  separate database, queue or cache.

## Database

Apply `backend/migrations/*.sql` in filename order (`0001` … `0043`) in the
Supabase SQL editor. Every file is idempotent. This branch adds **0036–0043**:

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

A deployment that already has 0001–0035 needs only 0036–0043, in order.

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
| `AI_PROVIDER` | intelligence is deterministic; `none` is the only accepted value | none |

Without `JOBS_ENABLED`, run `npm run db:maintenance` from cron (every few
minutes) — it runs every job once: unpaid-order expiry, refund reconciliation,
offer expiry, low-stock and expiry alerts, recurring tasks, reorder and
khata reminders, points expiry, support escalation and notification
deliveries.

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
- **AI provider** — photo recognition (M-53), photo/PDF invoices (M-54) and an optional LLM layer for the assistants would use Claude through the official `@anthropic-ai/sdk`. Adding it changes `backend/package-lock.json`, which was left untouched on purpose; with permission, add the dependency and implement the provider behind `AI_PROVIDER`.
