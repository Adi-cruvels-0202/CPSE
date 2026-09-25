# CPSE — Customer Portal & Shopping Experience

A shopping app for neighbourhood stores. A customer opens a shop from a link or a
QR code the shop shared, browses the catalogue, fills a cart, picks pickup or
delivery, pays in cash or online, and follows the order to the door.

One Node process serves both halves: the Express API **and** the React app, on
one port. Run the backend and you have the whole thing.

```
┌──────────────────────────────────────────┐
│  Express (backend/)                      │
│    /api/v1/*   →  the API                │
│    everything else →  the React app      │
│         dev: Vite in middleware mode     │
│         prod: frontend/dist              │
└──────────────┬───────────────────────────┘
               │
        Supabase (Postgres + Auth)
```

---

## What is here

| | |
|---|---|
| `backend/` | Express 4 API, Node 20+, ESM. Supabase for data and auth, Zod for every request body. |
| `frontend/` | React 18 + React Router, built with Vite. Plain JavaScript, no TypeScript. |
| `backend/migrations/` | 23 numbered SQL files. The whole schema. |
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
`backend/migrations/` in filename order — `0001` first, `0023` last. Each file is
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
login: **`test.customer@cpse.local`** / **`CpseTest!2026`**. Safe to re-run.

### 5. Install the frontend's dependencies

```bash
npm install --prefix ../frontend
```

No `.env` needed. The app calls `/api/v1` on whatever origin served it, so
there is no URL to configure.

### 6. Run it

```bash
npm run dev          # from backend/
```

Open **http://localhost:4000**. That is the app, not a JSON blob.

Vite runs *inside* the API process in middleware mode, sharing its HTTP socket
for hot reloads — so an edit under `frontend/src` appears without a rebuild, and
an edit under `backend/src` restarts the server. Two halves, one terminal.

<details>
<summary>Running the frontend on its own instead</summary>

```bash
npm run dev --prefix frontend   # http://localhost:5173
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
| `npm start` | Production mode — serves `frontend/dist`, no Vite |
| `npm run build` | Installs and builds the frontend into `frontend/dist` |
| `npm test` | 749 backend tests (Vitest + supertest, no live database needed) |
| `npm test --prefix ../frontend` | 575 frontend tests (Vitest + Testing Library) |
| `npm run db:seed` | Dummy stores, catalogue and khata |
| `npm run db:maintenance` | Expiry sweeps — stale carts, abandoned payments |

Both suites run against mocks, so a fresh clone can run them before touching
Supabase at all.

---

## Deploying

One web service on any Node host. On [Render](https://render.com), create a
**Web Service** from this repo and leave **Root Directory blank** — setting it to
`backend` makes Render skip deploys for frontend-only commits.

| Field | Value |
|---|---|
| Build Command | `cd frontend && npm ci --include=dev && npm run build && cd ../backend && npm ci` |
| Start Command | `cd backend && node src/server.js` |
| Health Check Path | `/api/v1/health` |

`--include=dev` on the frontend install is not optional: hosts set
`NODE_ENV=production`, which makes `npm ci` skip devDependencies — and Vite is
one.

Set `NODE_ENV=production`, the three Supabase values, and point
`PASSWORD_RESET_REDIRECT_URL` and `PAYMENT_MOCK_CHECKOUT_URL` at your deployed
URL. Leave `PORT` alone — the host injects it. Leave `ENABLE_TEST_ENDPOINTS`
off; the app refuses to boot in production if it is on, because it exposes an
endpoint that can march anyone's order to `completed`.

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
