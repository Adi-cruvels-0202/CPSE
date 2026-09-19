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

## Database

Migrations are numbered SQL files in `migrations/`, applied in filename order. Each one is
idempotent (`if not exists`, `or replace`), so re-running a file is a no-op.

Apply them in the **Supabase SQL editor** — the backend holds no direct Postgres connection and
never applies schema itself. Paste a file's contents and run it, or concatenate them all:

```bash
cat migrations/*.sql > schema.sql   # then paste into the SQL editor
```

Because there is no migration ledger, keep track of the highest file you have applied; the
numbering is the running order.

```bash
npm run db:seed   # dummy stores, catalogue and one test customer's khata
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

npm run db:seed   # see Database above
```

The whole suite runs offline against placeholder Supabase credentials and a mock Supabase
client — no database needed. Schema rules (every FK indexed, `updated_at` triggers, RLS on
every table) are checked by parsing `migrations/*.sql` in `tests/schema.test.js`.

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
| `GET` | `/api/v1/stores/:slug` | Optional | Public store page. `isSaved` is `null` when anonymous, a boolean when signed in. |
| `GET` | `/api/v1/stores/:slug/categories` | Optional | Active categories, in sort order. |
| `GET` | `/api/v1/stores/:slug/products` | Optional | `?categoryId=&page=&limit=&availableOnly=`. Paginated; sold-out items are returned with `isPurchasable: false`. |
| `GET` | `/api/v1/stores/:slug/products/:productId` | Optional | Full detail with images and variants. A product id from another store is a 404. |
| `GET` | `/api/v1/stores/:slug/search` | Optional | `?q=&categoryId=&page=&limit=`. Store-scoped, name + description, minimum 2 characters. |
| `GET` | `/api/v1/cart` | Bearer | `?storeId=`. Live totals, repriced from the catalogue on every read. |
| `POST` | `/api/v1/cart/items` | Bearer | `{ storeId, productId, variantId?, quantity }`. Same product + different variant is a separate line. |
| `PATCH` | `/api/v1/cart/items/:itemId` | Bearer | `{ quantity }`. Capped by stock and by 999. |
| `DELETE` | `/api/v1/cart/items/:itemId` | Bearer | Removes one line. |
| `DELETE` | `/api/v1/cart` | Bearer | `?storeId=`. Empties the cart, keeps the cart row. |
| `POST` | `/api/v1/cart/validate` | Bearer | `{ storeId, items?: [{ itemId, unitPricePaise }] }`. Per-item availability and price-drift issues. |
| `GET` | `/api/v1/addresses` | Bearer | Default first, then newest. |
| `POST` | `/api/v1/addresses` | Bearer | 201. The first address saved becomes the default. |
| `GET`/`PATCH`/`DELETE` | `/api/v1/addresses/:id` | Bearer | Another customer's address is a 404. |
| `POST` | `/api/v1/addresses/:id/default` | Bearer | Moves the default; at most one per customer. |
| `POST` | `/api/v1/checkout/quote` | Bearer | `{ storeId, fulfilmentMode, addressId?, customerNote? }`. Full priced summary plus `blockers`, `warnings` and `canPlaceOrder`. Changes nothing. |
| `GET` | `/api/v1/payments/methods` | — | What the platform can take. |
| `POST` | `/api/v1/orders` | Bearer | `{ storeId, fulfilmentMode, addressId?, paymentMethod, expectedTotalPaise? }`. Send `Idempotency-Key`; a replay returns the original order with **200**. |
| `GET` | `/api/v1/orders` | Bearer | `?status=&storeId=&page=&limit=`. Newest first. |
| `GET` | `/api/v1/orders/:id` | Bearer | Items, totals, payment, fulfilment and the status timeline. |
| `POST` | `/api/v1/orders/:id/cancel` | Bearer | Only from `pending_payment`, `placed` or `accepted`; otherwise 409. |
| `GET` | `/api/v1/orders/:id/receipt` | Bearer | Receipt payload, derived from the order's own snapshot. |
| `POST` | `/api/v1/orders/:id/reorder` | Bearer | Rebuilds the cart and reports what could not be added. |
| `POST` | `/api/v1/payments/:orderId/initiate` | Bearer | Returns the provider payload for the client. |
| `POST` | `/api/v1/payments/:orderId/verify` | Bearer | Client-side confirmation; the provider's answer decides, not the client's. |
| `POST` | `/api/v1/payments/webhook` | Signature | `X-CPSE-Signature`: HMAC-SHA256 of the raw body with `PAYMENT_WEBHOOK_SECRET`. Idempotent. |
| `POST` | `/api/v1/orders/:id/test-advance` | Bearer | ⚠️ **Test-only.** Stands in for the merchant dashboard. Mounted only when `ENABLE_TEST_ENDPOINTS=true`; the app refuses to boot in production with it on. |

Every `/auth/*` route sits behind the tighter `authLimiter` (`AUTH_RATE_LIMIT_MAX`) as well as
the global limiter.

Store routes are **public** — a shared link or QR code must open with no token (spec: public store
pages). They take an optional bearer token only to personalise, and an unknown slug, an inactive
store, or a category belonging to another store all return **404**.

### Ordering and payments

An order is never marked paid on a client's say-so. A **cash** order is `placed` immediately; an
**online** order is created as `pending_payment` and only becomes `placed` when the provider
confirms it, through the signed webhook or the verify endpoint.

Order creation is one Postgres function (`create_order`, migration 0020): the order, its items,
the first history entry, the payment intent, the stock decrement and the cart checkout all commit
together or not at all. If anything fails, the customer's cart is exactly as they left it.

Prices come from one place — `src/lib/pricing.js`. The cart, the checkout quote and the order all
call it, so the number a customer sees is the number they are charged. Catalogue prices are
tax-inclusive, so `taxPaise` is always 0 (the field exists because the column does).

The merchant side owns stores, products, inventory and order status transitions. That contract is
written down in [`docs/MERCHANT_INTEGRATION.md`](docs/MERCHANT_INTEGRATION.md).

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
  lib/         supabase clients, logger, errors, response helpers, opening-hours resolver
  middleware/  request context, validation, rate limiting, error handler
  modules/     one folder per domain: routes + controller + service
  routes.js    the full URL map
  app.js       express assembly
  server.js    listen + graceful shutdown
migrations/  numbered SQL, applied in order — 0001 enums ... 0020 create_order()
scripts/     seed.js, seed-data.js
docs/        MERCHANT_INTEGRATION.md — the customer/merchant API contract
tests/       the suite, plus helpers/ (mock Supabase client, migration parser)
```

See `../PROJECT_CHECKLIST.md` and `../PROJECT_CONTEXT.md` for the roadmap and current state.
