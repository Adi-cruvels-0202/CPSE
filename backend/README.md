# CPSE Backend

Customer Portal & Shopping Experience — Express API backed by Supabase (Postgres + Supabase Auth).

## Setup

```bash
cd backend
npm install
cp .env.example .env   # then fill in the Supabase values
```

Get the Supabase values from your project dashboard → **Project Settings → API**:

| Variable | Where |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key — **server-side only, never ship to the frontend** |
| `PASSWORD_RESET_REDIRECT_URL` | Where the reset email sends the customer. Must also be listed under **Authentication → URL Configuration → Redirect URLs**. |
| `DATABASE_URL` | **Project Settings → Database → Connection string** (Session pooler). Optional — only the migration runner uses it. |

## Database

Migrations are numbered SQL files in `migrations/`, applied in filename order. Each one is
idempotent on its own and is recorded in `public.schema_migrations`, so re-running is a no-op.

```bash
npm run db:migrate            # apply everything pending
npm run db:migrate -- --dry   # list what would run, change nothing
npm run db:seed               # dummy stores, catalogue and one test customer's khata
```

No `DATABASE_URL` to hand? Print the whole schema and paste it into the Supabase SQL editor:

```bash
npm run db:print > schema.sql
```

`db:seed` needs only the service-role key. It creates the login
`test.customer@cpse.local` / `CpseTest!2026` and is safe to re-run — every seeded row has a
fixed id and is upserted. It refuses to run with `NODE_ENV=production`.

**Money is stored as integer paise everywhere** (`price_paise`, `total_paise`, …). Never a float.

**Row Level Security is on for every table.** The API uses the service-role key, which bypasses
RLS, so ownership is still enforced in application code — the policies are defense-in-depth for
anything that reaches Postgres with an anon or user token.

## Commands

```bash
npm run dev     # start with file watching
npm start       # start
npm test        # run the test suite
npm run test:watch
npm run test:coverage

npm run db:migrate   # see Database below
npm run db:seed
npm run db:print
```

The suite runs offline with placeholder credentials. The live schema tests in `tests/db/`
skip themselves unless `DATABASE_URL` is set:

```bash
npm run db:migrate && npm test    # with DATABASE_URL in .env, runs those too
```

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/v1/health` | — | Liveness. Does not touch the database. |
| `POST` | `/api/v1/auth/register` | — | 201. Returns `{ customer, session, emailConfirmationRequired }`; `session` is null when email confirmation is on. |
| `POST` | `/api/v1/auth/login` | — | 401 on bad credentials, with the same message for an unknown email. |
| `POST` | `/api/v1/auth/refresh` | — | Rotates the session. |
| `POST` | `/api/v1/auth/logout` | Bearer | 204. Revokes refresh tokens globally. |
| `POST` | `/api/v1/auth/forgot-password` | — | Always 200, whether or not the email is registered. |
| `POST` | `/api/v1/auth/reset-password` | — | Takes the `accessToken` from the emailed link. |
| `GET` | `/api/v1/me` | Bearer | Current profile. |
| `PATCH` | `/api/v1/me` | Bearer | `fullName`, `phone`, `avatarUrl`. Sending `email` or `id` is a 422, not a silent no-op. |

Every `/auth/*` route sits behind the tighter `authLimiter` (`AUTH_RATE_LIMIT_MAX`) as well as
the global limiter.

Authenticate with the Supabase access token:

```
Authorization: Bearer <accessToken>
```

`requireAuth` verifies it with Supabase and puts the profile on `req.customer`; `optionalAuth`
does the same but lets anonymous requests through, for public store pages that personalise
when signed in.

## Conventions

**Base path:** every route is mounted under `/api/v1`.

**Success envelope**
```json
{ "success": true, "data": { }, "meta": { } }
```

**Error envelope**
```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "...", "details": {} }, "requestId": "..." }
```

`X-Request-Id` is echoed on every response; send your own to trace a request end to end.

**Ownership:** a resource that exists but belongs to another customer returns **404**, never 403 —
a 403 would confirm the resource exists.

## Layout

```
src/
  config/      env loading and validation (nothing else reads process.env)
  lib/         supabase clients, logger, errors, response helpers
  middleware/  request context, validation, rate limiting, error handler
  modules/     one folder per domain: routes + controller + service
  routes.js    the full URL map
  app.js       express assembly
  server.js    listen + graceful shutdown
migrations/  numbered SQL, applied in order — 0001 enums ... 0018 RLS policies
scripts/     migrate.js, print-migrations.js, seed.js, seed-data.js
tests/
  db/        live tests, skipped unless DATABASE_URL is set
```

See `../PROJECT_CHECKLIST.md` and `../PROJECT_CONTEXT.md` for the roadmap and current state.
