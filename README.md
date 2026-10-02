# CPSE — Customer Portal & Shopping Experience

A shopping app for neighbourhood stores, for both sides of the counter.

- **Customers** open a shop from a link or a QR code the shop shared, browse the
  catalogue, fill a cart, pick pickup or delivery, pay in cash or online, and
  follow the order to the door.
- **Shopkeepers** set up their store, add products and photos, keep stock, accept
  and fulfil online orders, ring up walk-in customers at the counter, and see the
  day on a dashboard.

One login serves both: a shopkeeper is a customer account with a merchant
profile, and signing in on one app signs you in on the other.

One Node process serves everything — the Express API **and** both React apps, on
one port. Run the backend and you have the whole thing.

```
┌───────────────────────────────────────────────┐
│  Express (backend/)                           │
│    /api/v1/*      →  the API                  │
│    /merchant/*    →  the merchant app         │
│    everything else →  the customer app        │
│         dev: Vite in middleware mode          │
│         prod: frontend/*/dist                 │
└──────────────┬────────────────────────────────┘
               │
        Supabase (Postgres + Auth + Storage)
```

---

## What is here

| | |
|---|---|
| `backend/` | Express 4 API, Node 20+, ESM. Supabase for data and auth, Zod for every request body. |
| `frontend/customer/` | The customer app. React 18 + React Router, built with Vite. Plain JavaScript for now (moving to TypeScript gradually — see `docs/MERGE_MAPPING.md` D-9). |
| `frontend/merchant/` | The shopkeeper app ("Merchant One", from Merchant-One), served at `/merchant`. React + TypeScript + TanStack Query, built with Vite. |
| `backend/migrations/` | 33 numbered SQL files. The whole schema. |
| `backend/docs/API.md` | Every endpoint, its body and its errors. |
| `backend/docs/MERCHANT_INTEGRATION.md` | The contract with the merchant side, which this repo does **not** contain. |

**Out of scope, deliberately:** the merchant dashboard, inventory management and
network-wide store discovery. Stores, categories and products are *read* here and
written by the merchant side; the seed script stands in for it during
development. See `MERCHANT_INTEGRATION.md` before wiring the two together.

---

## Running it after a clone

### 1. What you need

- **Node 20 or newer** (`node -v`) and npm
- A **Supabase** project — the free tier is enough. It provides Postgres *and*
  the auth system; there is no separate database to install.

### 2. Create the database

In the Supabase dashboard, open the **SQL editor** and apply
`backend/migrations/` in filename order — `0001` first, `0033` last. Each file is
idempotent, so re-running one is harmless. To do it in one paste:

```bash
cat backend/migrations/*.sql > /tmp/schema.sql
```

There is no migration ledger, so keep a note of the highest number you have
applied. The backend never applies schema itself.

### 3. Configure the backend

```bash
cd backend
npm install
cp .env.example .env
```

Fill in three values from **Project Settings → API** in Supabase:

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | the `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` key |

> The service-role key bypasses row-level security completely. It stays on the
> server and never reaches the browser. `.env` is gitignored — keep it that way.

Everything else in `.env.example` has a working default and is documented in
place.

One dashboard setting matters: under **Authentication → URL Configuration →
Redirect URLs**, add `http://localhost:4000/reset-password`, or password-reset
emails will refuse to come back to the app.

### 4. Seed some data

```bash
npm run db:seed
```

Three dummy stores with a catalogue, variants and opening hours, plus a test
login: **`test.customer@cpse.local`** / **`CpseTest!2026`**, and the shopkeeper who owns every
seeded store: **`demo.merchant@cpse.local`** / **`CpseMerchant!2026`**. Safe to re-run.

Real product photos are optional: put them in `backend/catlog photos/`, named after
the product (`toor_dal.png` → Toor Dal), and the seed uploads them to Supabase
Storage and uses them in place of the placeholders. The folder is git-ignored —
photos are megabytes each.

### 5. Install the frontends' dependencies

```bash
npm install --prefix ../frontend/customer
npm install --prefix ../frontend/merchant
```

No `.env` needed. Both apps call `/api/v1` on whatever origin served them, so
there is no URL to configure.

### 6. Run it

```bash
npm run dev          # from backend/
```

Open **http://localhost:4000** for the shop, and **http://localhost:4000/merchant**
for the shopkeeper side (`demo.merchant@cpse.local` / `CpseMerchant!2026` after
seeding). The customer app's login and account pages link across.

Each app's Vite runs *inside* the API process in middleware mode — so an edit
under `frontend/*/src` appears without a rebuild, and an edit under `backend/src`
restarts the server. Everything, one terminal. (The merchant app's hot-reload
socket is on port 24679, so the two Vites never compete for one connection.)

<details>
<summary>Running a frontend on its own instead</summary>

```bash
npm run dev --prefix frontend/customer   # http://localhost:5173
npm run dev --prefix frontend/merchant   # http://localhost:5174/merchant/
```

Vite proxies `/api` to port 4000, so the backend still has to be running. You
would only want this to isolate a frontend problem.
</details>

---

## Everyday commands

All from `backend/` unless noted.

| Command | What it does |
|---|---|
| `npm run dev` | API + app with hot reload, on :4000 |
| `npm start` | Production mode — serves `frontend/customer/dist` and `frontend/merchant/dist`, no Vite |
| `npm run build` | Installs and builds both apps into their `dist/` folders |
| `npm test` | 1267 backend tests (Vitest + supertest, plus the SQL run on real Postgres in WebAssembly — PGlite — one file at a time; no live database needed) |
| `npm test --prefix ../frontend/customer` | 581 customer-app tests (Vitest + Testing Library) |
| `npm test --prefix ../frontend/merchant` | 13 merchant-app tests (money, the shared session, the API client) |
| `npm run typecheck --prefix ../frontend/merchant` | TypeScript check of the merchant app |
| `npm run db:seed` | Dummy stores, catalogue and khata |
| `npm run db:maintenance` | Expiry sweeps — stale carts, abandoned payments |

Every suite runs against mocks or an in-process Postgres, so a fresh clone can
run them before touching Supabase at all.

---

## Deploying

One web service on any Node host. On [Render](https://render.com), create a
**Web Service** from this repo and leave **Root Directory blank** — setting it to
`backend` makes Render skip deploys for frontend-only commits.

| Field | Value |
|---|---|
| Build Command | `cd backend && npm ci && npm run build` |
| Start Command | `cd backend && node src/server.js` |
| Health Check Path | `/api/v1/health` |

`--include=dev` on the frontend install is not optional: hosts set
`NODE_ENV=production`, which makes `npm ci` skip devDependencies — and Vite is
one.

Set `NODE_ENV=production`, the three Supabase values, and point
`PASSWORD_RESET_REDIRECT_URL` and `PAYMENT_MOCK_CHECKOUT_URL` at your deployed
URL. Leave `PORT` alone — the host injects it.

---

## Notes for anyone reading the code

- **Money is integer paise everywhere.** No floats, no decimals, no exceptions.
  `₹199.00` is `19900`.
- **Order lines are snapshots.** A shop editing a product later never rewrites
  what an old order says it cost.
- **The cart stores no prices.** Every read reprices from the catalogue, so a
  change is visible immediately rather than at the till.
- **Store hours are resolved server-side** in the shop's own timezone. A browser
  computing "open now" from its own clock would disagree with the shop.
- Payments run through a `mock` provider. The seam is real — the gateway is
  swappable — but no live gateway is wired up.
