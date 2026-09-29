# Work Plan — one week — Aditya (backend) + Mohit (frontend)

> Companion to `docs/MERGE_MAPPING.md`, which says **what** the merged platform looks like.
> This file says **who builds what, day by day, and how we stay in sync.**
> **Deadline: 7 days from Day 1.** Status: proposed 2026-09-29 — both of us agree before Day 1.

---

## 1. The honest constraint

Merchant-One is ~6.7k lines of Java plus ~4.5k lines of frontend to rewire. That does not all fit
into one week at the quality the customer side was built to. So the scope is split into three tiers,
and **P0 is the promise**:

| Tier | Meaning | What is in it |
|---|---|---|
| **P0 — must ship** | The full loop works: a merchant sets up a shop and products, a customer orders, the merchant handles the order, stock and the customer's notifications update | Repo restructure · schema · tax (D-4) + stock reservation (D-5) in `create_order` · merchant login + roles · store setup (details, hours, delivery, payment methods, publish) · categories + products + variants (image **URLs**) · inventory stock-in / adjust + ledger · merchant orders (accept, reject, status, complete) · GST line in the customer app |
| **P1 — should ship** | Built on Day 6 only if P0 is merged by end of Day 5 | Image **upload** (Supabase Storage) · store holidays · POS / direct sales · dashboard metrics |
| **P2 — after this week** | Not attempted this week; listed so nobody thinks it was forgotten | Purchases + batches + expiry · product duplicate · category reorder · converting the customer app to TypeScript · archiving Merchant-One |

**Rule:** if a P0 item slips by more than half a day, P1 is cut — not P0, and not tests.

---

## 2. Who owns what

| | **Aditya** | **Mohit** |
|---|---|---|
| **Owns** | `backend/` — the one backend (Node/Express + Supabase) and `frontend/customer/` | `frontend/merchant/` — the shopkeeper app (React + TS) |
| Builds | Migrations, auth + roles, every merchant API module, `create_order` changes, tests, `backend/docs/API.md` | Moving his app in, rewiring it to the new API, deleting the old storefront pages, every merchant screen working end to end |
| Also | Applies migrations to Supabase (only person who does) | Writes `docs/MERCHANT_RULES.md` on Day 1 — the business rules from his Java code |
| Reviews | Every frontend PR | Every backend PR (checks his rules were ported correctly) |

Nobody's work is thrown away: the backend is built on Aditya's stack, and Mohit's frontend is
already TypeScript (D-9), so it is **rewired, not rewritten**.

---

## 3. How we stay in sync in one week

1. **All API contracts on Day 1, in one PR.** Aditya adds every P0 merchant endpoint to
   `backend/docs/API.md` — URL, method, request, response example, error codes. Mohit reviews it
   the same day. From then on the frontend builds against that document, not against guesses.
2. **Mohit never waits.** Until an endpoint is merged, his screen uses mock responses copied from
   the contract. When the backend PR merges, he swaps the mock for the real call.
3. **Review within 2 hours.** A PR waiting a day costs a seventh of the schedule.
4. **Contract changes go through a PR** to `API.md`, never only in chat. A silently changed
   response shape is the bug from CPSE session 19 (D101).
5. **End-of-day check-in, 10 minutes:** merged today, doing tomorrow, blocked on.

---

## 4. Conventions Mohit's app has to adopt

| Topic | Old (Merchant-One) | New |
|---|---|---|
| Base URL | `/api/...` | `/api/v1/merchant/stores/:storeId/...` (merchant), `/api/v1/auth/...` (shared login) |
| Response envelope | `{ success, message, data }` | `{ success: true, data }` / `{ success: false, error: { code, message, details? } }` |
| Errors | read `message` | switch on `error.code`; show `error.message` as written |
| Money | rupees as decimals (`50.00`) | **integer paise** (`5000`) — format only for display |
| Auth | own JWT from `/api/auth/login` | Supabase access + refresh tokens from `/api/v1/auth/login`; `Authorization: Bearer`; refresh once on 401 |
| Order status | `PENDING`, `READY`, … | `placed`, `ready_for_pickup`, `out_for_delivery`, … (MERGE_MAPPING §4.4) |
| Tax | computed on the server | still on the server — screens only display `taxPaise` |
| Storefront pages | `StorefrontPage`, `CheckoutModal` | **deleted** — the customer app owns this |

---

## 5. Day by day

Each day ends with its PRs **merged**, not just opened.

### Day 1 — set up, and agree the API

| Aditya | Mohit |
|---|---|
| ☐ **Morning:** PR `chore/restructure` — move `frontend/` → `frontend/customer/`, fix scripts and docs paths. Merge by noon. | ☐ **Morning:** write `docs/MERCHANT_RULES.md` — every rule in his Java code in plain English: stock-in, adjust, reservation, order accept/reject/complete, validation limits. Aditya needs it to port the logic. |
| ☐ **Afternoon:** PR `contract/merchant-api` — every P0 endpoint in `backend/docs/API.md` (auth, stores, catalogue, inventory, orders). | ☐ **After restructure merges:** PR `frontend/merchant-import` — copy his app into `frontend/merchant/`, delete `StorefrontPage` + `CheckoutModal`, make it build. |
| ☐ Start migrations `0024+` (local). | ☐ **Evening:** review and approve `contract/merchant-api`. |

**End of Day 1:** repo restructured, merchant app in the repo, the API agreed.

### Day 2 — schema, orders core, login

| Aditya | Mohit |
|---|---|
| ☐ PR `backend/schema` — migrations `0024+`: `merchants`, store owner + settings columns, `payment_preferences`, variant fields (`sku`, `cost_paise`, `tax_percent`, `quantity_on_hand`, `reserved_quantity`, `version`), `inventory_ledger`, order-item tax columns; default-variant backfill. Applied to dev Supabase. | ☐ PR `frontend/api-client` — new API client: envelope, error codes, bearer + refresh-on-401, paise formatting, new order-status labels. |
| ☐ Same PR or next: `create_order` reserves stock + adds tax per line (D-4, D-5); cancel / reject / expiry release the reservation. **All existing customer tests pass** (totals updated for tax). | ☐ Login + register screens against the contract (mocks). |
| ☐ PR `backend/merchant-auth` — merchant register, role on login, `requireRole`, `requireStoreOwner`, route audit covers `/merchant`. | ☐ Switch login to the real API once `merchant-auth` merges. |

**End of Day 2:** a merchant can register and sign in to the merchant app against the real backend.

### Day 3 — store setup

| Aditya | Mohit |
|---|---|
| ☐ PR `backend/merchant-stores` — create, list mine, edit, publish/unpublish, opening hours (writes the jsonb, D-8), delivery settings, payment preferences. | ☐ Store setup screens (details, hours, delivery, payments, publish) → real API as soon as the backend PR merges. |
| ☐ Start `backend/merchant-catalogue`. | ☐ Category + product screens on mocks. |

**End of Day 3:** a merchant creates and publishes a shop, and **it appears in the customer app**.

### Day 4 — catalogue and inventory

| Aditya | Mohit |
|---|---|
| ☐ PR `backend/merchant-catalogue` — categories (CRUD, activate/deactivate), products + variants (CRUD, activate/deactivate, image URLs). | ☐ Catalogue screens → real API. |
| ☐ PR `backend/merchant-inventory` — stock-in, adjust, stock-out, ledger history; every movement writes a ledger row. | ☐ Inventory + ledger history screens (mocks → real). |

**End of Day 4:** a merchant adds products with stock, and **a customer can buy them**.

### Day 5 — merchant orders (P0 freeze)

| Aditya | Mohit |
|---|---|
| ☐ PR `backend/merchant-orders` — list (filter by status), detail, accept, reject, move status, complete. Everything goes through `transitionOrder`, so the customer is notified. Complete deducts stock; reject/cancel releases it. Delete `test-advance`. | ☐ Orders list + detail + action buttons → real API. |
| ☐ Seed script: a demo merchant owning the seeded stores. | ☐ Fix anything found while clicking through Days 2–4. |
| ☐ Customer app: GST line on cart, checkout, receipt; "+ GST" on the product page. | |

**End of Day 5 — P0 FREEZE:** the full loop works. If it does not, Day 6 is spent finishing P0, not starting P1.

### Day 6 — P1 (only if P0 is merged)

| Aditya | Mohit |
|---|---|
| ☐ Image upload → Supabase Storage (logo, cover, product images). | ☐ Image upload in store + product screens. |
| ☐ POS / direct sales (deducts on-hand, sells only *available* stock, writes ledger). | ☐ POS screen. |
| ☐ Dashboard metrics. | ☐ Dashboard screen. |
| ☐ Store holidays (open/closed respects them). | ☐ Holidays screen. |

### Day 7 — test together, no new features

| Both, together |
|---|
| ☐ Full walkthrough, on a phone for the customer side: merchant registers → sets up shop → adds products + stock → customer browses → orders with GST → merchant accepts → customer notified → merchant completes → stock and ledger correct. Also: a reject returns stock, and two customers cannot both buy the last unit. |
| ☐ Bug fixes only. |
| ☐ Update `README.md`, `DEPLOYMENT.md`, `PROJECT_CONTEXT.md`, this file's progress table. |
| ☐ Demo to the lead. |

---

## 6. Environments

| | How |
|---|---|
| Supabase | **One shared dev project** (the existing CPSE one). Only Aditya applies migrations, in number order, and says so in chat when one is applied. |
| Backend locally | Both run `backend/` locally against the dev Supabase project. Aditya shares `backend/.env` values privately — never in Git or a PR. |
| Frontends locally | Customer and merchant apps on different Vite ports, both pointing at the local backend. |

---

## 7. Git rules (both of us)

- Never work on `main`; it only changes through a reviewed PR.
- Start every task from a fresh `main`:
  ```bash
  git checkout main && git pull
  git checkout -b backend/merchant-stores     # or frontend/…, contract/…, docs/…, chore/…
  ```
- One PR per row in §5. Small enough to review in 20 minutes; reviewed within 2 hours.
- A PR with failing tests is not merged.
- Branch behind `main`? Update before merging:
  ```bash
  git checkout main && git pull
  git checkout <your-branch> && git merge main
  ```
- Commits that port Mohit's logic end with `Co-authored-by: Mohit <his GitHub email>`.
- Do not edit the other person's folder without telling them.

---

## 8. Progress

| Item | Tier | Contract | Backend | Frontend | Done |
|---|---|---|---|---|---|
| Repo restructure | P0 | — | ☐ | ☐ | ☐ |
| Merchant rules document | P0 | — | — | — | ☐ |
| Schema + `create_order` (tax, stock) | P0 | — | ☐ | — | ☐ |
| Auth + roles | P0 | ☐ | ☐ | ☐ | ☐ |
| Store setup | P0 | ☐ | ☐ | ☐ | ☐ |
| Catalogue | P0 | ☐ | ☐ | ☐ | ☐ |
| Inventory + ledger | P0 | ☐ | ☐ | ☐ | ☐ |
| Merchant orders | P0 | ☐ | ☐ | ☐ | ☐ |
| Customer GST display | P0 | — | — | ☐ | ☐ |
| Image upload | P1 | ☐ | ☐ | ☐ | ☐ |
| POS / sales | P1 | ☐ | ☐ | ☐ | ☐ |
| Dashboard | P1 | ☐ | ☐ | ☐ | ☐ |
| Holidays | P1 | ☐ | ☐ | ☐ | ☐ |
| End-to-end walkthrough | P0 | — | — | — | ☐ |
| Purchases + batches, TS conversion, archive | P2 | after this week | | | |
