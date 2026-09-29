# Merge Mapping — CPSE (Customer) + Merchant-One (Shopkeeper)

> **Status: DECISIONS AGREED (2026-09-29) — all of §5 decided by Aditya; awaiting review by Mohit and the lead.**
> Integration starts with step 1 (§8) once this document is merged.
> This is step 1 of the merge instructions: compare both projects, map every feature,
> and decide what is kept, migrated or combined — before integrating anything.

---

## 1. The goal

One Local Commerce platform with two user experiences on one shared backend:

```
                   COMMERCE
                       │
             ┌─────────┴─────────┐
             │                   │
         CUSTOMER            SHOPKEEPER
     (browse, cart,       (store setup, catalogue,
   checkout, orders,      inventory, orders, POS
   khata, alerts)         purchases, dashboard)
             │                   │
             └─────────┬─────────┘
                       │
                SHARED PLATFORM
       auth · stores · catalogue · orders ·
       payments · notifications · pricing
                       │
              PostgreSQL (Supabase)
```

**Rules**
- Different users → different features and UI.
- Same functionality → one common implementation.
- Different existing technologies → compare first, then standardise gradually.

---

## 2. What each project is today

| | **CPSE — Aditya** | **Merchant-One — Mohit** |
|---|---|---|
| Repo | `Adi-cruvels-0202/CPSE` | `MOHITgit77/Merchant-One` |
| Scope | Customer journey: store page → cart → checkout → payment → orders → notifications → khata (read-only) | Shopkeeper tools: store setup, catalogue, inventory, purchases/batches, POS sales, order management, dashboard. **Also a public storefront + checkout** |
| Backend | Node.js + Express, plain JavaScript (ESM) | Java 21 + Spring Boot 3, Spring Security, JPA/Hibernate |
| Database | Supabase Postgres; 23 plain-SQL migrations applied in the SQL editor | Local Postgres 16 in Docker; 10 Flyway migrations |
| Auth | Supabase Auth (`customers.id` → `auth.users.id`) | Own `users` table with `password_hash`, self-issued JWT |
| Money | Integer **paise** everywhere | `DECIMAL(10,2)` / `NUMERIC(12,2)` **rupees** |
| Validation | Zod, strict schemas | Bean Validation (DTOs) |
| API prefix | `/api/v1/...` | `/api/...` (merchant), `/api/storefront/...` (public) |
| Response envelope | `{ success, data }` / `{ success:false, error:{code,message} }` | `{ success, message, data }` |
| Frontend | React 18 + Vite, **JavaScript**, hand-written fetch wrapper | React 19 + Vite, **TypeScript**, axios, React Query, React Hook Form |
| Images | URLs only (no upload) | Multipart upload to local disk (`./uploads`) |
| Tests | 749 backend + 555 frontend (vitest), offline | 19 backend (JUnit), 1 shell e2e script |
| Size (approx.) | ~5.5k lines backend, ~8.6k lines frontend | ~6.7k lines Java, ~4.5k lines TS/TSX |

---

## 3. Feature mapping

Legend — **Keep A**: keep Aditya's · **Keep M**: keep Mohit's · **Port M**: keep Mohit's
behaviour, re-implemented in the common backend · **Combine**: one implementation built from both · **Drop**: removed as a duplicate.

### 3.1 Customer-specific

| Feature | Aditya | Mohit | Final | Action |
|---|---|---|---|---|
| Public store page by slug (opens from a shared link) | `GET /stores/:slug`, open/closed computed server-side | `GET /storefront/{slug}` | Aditya's | **Keep A**, drop M's |
| Categories / product listing / detail | `/stores/:slug/categories`, `/products`, `/products/:id` | `/storefront/{slug}/categories`, `/products`, `/products/{id}` | Aditya's | **Keep A**, drop M's |
| Store-scoped search | `/stores/:slug/search` | `?search=` on product list | Aditya's | **Keep A** |
| Customer account (register, login, profile, reset) | ✅ | ❌ | Aditya's | **Keep A** |
| Addresses | ✅ | free-text `delivery_address` on order | Aditya's | **Keep A** |
| Cart (server-side, repriced on read) | ✅ | ❌ (client-side cart in `CheckoutModal`) | Aditya's | **Keep A** |
| Checkout quote + order placement | ✅ auth required, idempotent, one DB transaction (`create_order`) | ✅ anonymous, name + phone only | Aditya's | **Keep A**, drop `POST /storefront/{slug}/orders` |
| Payments (provider abstraction, webhook, verify) | ✅ mock provider | payment method recorded only | Aditya's | **Keep A** |
| Order history, receipt, reorder, customer cancel | ✅ | ❌ | Aditya's | **Keep A** |
| Notifications | ✅ | ❌ | Aditya's | **Keep A** (merchant events added later) |
| Saved stores | ✅ | ❌ | Aditya's | **Keep A** |
| Khata (customer view, read-only) | ✅ | ❌ | Aditya's | **Keep A** |
| Storefront UI (`StorefrontPage`, `CheckoutModal`) | — | ✅ | — | **Drop** — customer app owns this |

### 3.2 Shopkeeper-specific

| Feature | Aditya | Mohit | Final | Action |
|---|---|---|---|---|
| Store create / edit / publish | seed data only | ✅ `StoreController` | Mohit's behaviour | **Port M** onto shared `stores` |
| Opening hours | `stores.opening_hours` jsonb + `timezone` | `store_hours` table | Aditya's storage, Mohit's editor UI | **Combine** (decision D-8) |
| Holidays | ❌ | `store_holidays` | Mohit's | **Port M** (+ open/closed must respect it) |
| Delivery settings (fee, min order, radius, free threshold) | columns on `stores` | `delivery_settings` table | columns on `stores` | **Combine** — add radius + free threshold |
| Payment preferences per store | ❌ (global method list) | `payment_preferences` (CASH, UPI, CARD, NET_BANKING) | Mohit's table | **Port M**; checkout reads it |
| Logo / cover upload | ❌ | local disk | Supabase Storage | **Port M**, change storage |
| Category CRUD, activate, reorder | read-only | ✅ | Mohit's behaviour | **Port M** |
| Product CRUD, duplicate, images | read-only | ✅ | Mohit's behaviour | **Port M** |
| Variants, SKU, barcode, cost price, unit | name + price + stock | ✅ full | Mohit's fields on Aditya's tables | **Combine** (decision D-6) |
| Inventory: stock in / out / adjust, ledger | ❌ | ✅ `inventory_ledger` | Mohit's | **Port M** |
| Purchases, batches, expiry | ❌ | ✅ | Mohit's | **Port M** |
| POS / direct sales, invoices | ❌ | ✅ | Mohit's | **Port M** |
| Merchant order list / accept / reject / status | test-only `POST /orders/:id/test-advance` | ✅ `MerchantOrderController` | Mohit's endpoints on Aditya's state machine | **Combine** — must go through `transitionOrder` so the customer is notified; `test-advance` is deleted |
| Dashboard metrics | ❌ | ✅ | Mohit's | **Port M** |
| Khata — merchant writes (credit, payment received) | ❌ | ❌ | — | **Later** (new feature, not part of merge) |

### 3.3 Common — exactly one implementation each

| Concern | Aditya | Mohit | Final | Action |
|---|---|---|---|---|
| Authentication | Supabase Auth, bearer access/refresh pair | custom JWT + bcrypt | Supabase Auth, role-aware | **Keep A**, extend with roles (D-2) |
| User model | `customers` | `users` (MERCHANT, ADMIN) | `auth.users` + `customers` + `merchants` | **Combine** (D-2) |
| Store model | `stores` | `stores` + 3 settings tables | Aditya's `stores`, extended | **Combine** |
| Category model | `categories` (`sort_order`, `slug`) | `categories` (`display_order`, `description`) | Aditya's, + `description` | **Combine** |
| Product / variant model | see §4 | see §4 | Aditya's tables, + Mohit's columns | **Combine** (D-6) |
| Order model | `orders` with `customer_id`, paise, payment status | `orders` with name/phone, rupees | Aditya's | **Keep A** (D-7) |
| Order state machine | `order.state.js`, 9 states | `OrderStatus.java`, 7 states | Aditya's | **Keep A** (D-7) |
| Stock model | single `stock` counter, decremented at order placement | `quantity_on_hand` + `reserved_quantity` + ledger | Mohit's model, reserved at placement | **Combine** (D-5 = C) |
| Pricing / tax | tax-inclusive, `tax_paise = 0` | `tax_percent` added on top | Mohit's rule inside Aditya's pricing engine | **Combine** (D-4 = B) |
| Money representation | integer paise | decimal rupees | integer paise | **Keep A** (D-3) |
| Payments | provider abstraction | method enum only | Aditya's abstraction + Mohit's per-store preferences | **Combine** |
| Notifications | emitted from `transitionOrder` | ❌ | Aditya's | **Keep A** |
| API conventions (prefix, envelope, error codes) | `/api/v1`, `{success,data}` / `{error:{code,message}}` | `/api`, `{success,message,data}` | Aditya's | **Keep A** |
| Migrations | plain SQL, numbered | Flyway | plain SQL, numbered | **Keep A**; Mohit's V1–V10 re-expressed as `0024+` |
| Backend runtime | Node/Express | Spring Boot | **one of them** | **Decide** (D-1) |
| Frontend standard | React + JS | React + TS | React + TS | **Decide** (D-9) |

---

## 4. Schema differences in detail

Stores, categories, products, variants and orders exist on **both** sides with different
columns. The merged schema needs one of each.

### 4.1 `stores`

| Column | Aditya | Mohit | Merged |
|---|---|---|---|
| owner | — | `merchant_id → users` | **add** `owner_id → merchants` |
| visibility | `is_active` | `is_published` | **both**: `is_active` (admin kill-switch), `is_published` (merchant toggle) |
| category | — | `shop_category` enum | **add** |
| address | `address_line1/2, city, state, postal_code, country` | single `address` string | Aditya's structured form |
| hours | `opening_hours` jsonb + `timezone` | `store_hours` rows | Aditya's (D-8) |
| delivery | `delivery_enabled, delivery_fee_paise, min_order_paise` | `delivery_settings` table | Aditya's columns **+** `delivery_radius_km`, `free_delivery_threshold_paise` |
| payments | — | `payment_preferences` table | **add** Mohit's table |

### 4.2 `products` / `product_variants`

| Column | Aditya | Mohit | Merged |
|---|---|---|---|
| price | `products.price_paise`, variant `price_paise` (absolute) | `products.price`, variant `price` (absolute) | paise, absolute — same rule both sides |
| MRP | `mrp_paise` | `compare_at_price` | `mrp_paise` |
| cost | — | `cost_price` (product + variant) | **add** `cost_paise` — merchant-only, never returned to customers |
| tax | — | `tax_percent` | **add** `tax_percent` (D-4 = B) |
| unit | — | `unit` (PCS, KG, L, …) | **add** |
| variants required? | optional — a product can have none | every product has ≥1 variant | D-6 |
| SKU / barcode / weight | — | ✅ | **add** to variants |
| stock | `stock` (null = untracked) on product and variant | `quantity_on_hand`, `reserved_quantity` on variant; `track_inventory` on product | Mohit's columns; stock reserved at order placement (D-5 = C) |
| low-stock threshold | — | ✅ | **add** |
| optimistic lock | row locks inside `create_order` | `version` column | **add** `version`; keep the row locks |
| slug | `products.slug` | — | keep |

### 4.3 `orders` / `order_items`

| Column | Aditya | Mohit | Merged |
|---|---|---|---|
| customer | `customer_id → customers` (required) | `customer_name`, `customer_phone`, `customer_email` | Aditya's. POS walk-ins use `sales`, not `orders` |
| status | `order_status` enum (9 values) | `VARCHAR` (7 values) | Aditya's (D-7) |
| fulfilment | `fulfilment_mode` enum `pickup/delivery` | `order_type` `PICKUP/DELIVERY` | Aditya's |
| payment | `payment_status` + `payments` table | `payment_method` string | Aditya's |
| money | `*_paise` + CHECK `total = subtotal − discount + fee + tax` | `NUMERIC` rupees, no invariant | Aditya's |
| merchant fields | `cancellation_reason` | `merchant_notes`, `accepted_at`, `rejected_at` | **add** Mohit's |
| snapshots | name, price, variant, address, store | name, variant, SKU | Aditya's **+** SKU |
| history | `order_status_history` | timestamps only | Aditya's |

### 4.4 Order status mapping

| Mohit | Aditya | Note |
|---|---|---|
| — | `pending_payment` | online payment not yet confirmed; merchant must never move an order out of it |
| `PENDING` | `placed` | |
| `ACCEPTED` | `accepted` | |
| `PREPARING` | `preparing` | |
| `READY` | `ready_for_pickup` / `out_for_delivery` | split by fulfilment mode |
| `COMPLETED` | `completed` | |
| `REJECTED` | `rejected` | |
| `CANCELLED` | `cancelled` | |

### 4.5 Tables that exist on one side only (all kept)

- **Aditya:** `customers`, `addresses`, `carts`, `cart_items`, `order_status_history`, `payments`,
  `saved_stores`, `notifications`, `khata_accounts`, `khata_transactions`.
- **Mohit:** `store_holidays`, `payment_preferences`, `inventory_ledger`, `sales`, `sale_items`,
  `purchases`, `purchase_items`, `batches`. (`users` is replaced by `merchants`; `store_hours` and
  `delivery_settings` fold into `stores`.)

---

## 5. Decisions to agree

Each has a recommendation. **Bold rows need the lead's answer**, because they are business
rules rather than engineering choices.

| # | Decision | Options | Recommendation | Why |
|---|---|---|---|---|
| — | **Database + auth platform** | Supabase · self-hosted Postgres + own JWT | **Supabase — ✅ agreed 2026-09-29** | Postgres, Auth and Storage in one place for both sides. Settles D-2 and D-10 below. |
| D-1 ✅ | **Common backend** | Node/Express + Supabase · Spring Boot + Postgres | **Node/Express + Supabase** — ✅ agreed 2026-09-29 | The customer path carries the integrity-critical logic (idempotent order creation, a single-transaction `create_order`, payment webhooks, RLS, khata ledger). Supabase Auth is the shared auth the spec requires. It already has 749 backend tests. Mohit's Java logic is **ported, not discarded** — every merchant rule in §3.2 carries over. |
| D-2 ✅ | Auth and roles | one auth for both · separate auth per side | **Supabase Auth for both**; a `merchants` table (like `customers`) keyed by `auth.users.id`; role checked by `requireRole('merchant')`; store access by `requireStoreOwner` | One login system, one token format. A person could later be both a customer and a merchant with the same account. |
| D-3 ✅ | Money | paise · decimal rupees | **Integer paise** — ✅ agreed 2026-09-29 | No floating/rounding drift; the order CHECK invariant depends on it. Java `BigDecimal` values convert ×100 on the way in. |
| **D-4 ✅** | **Tax** | A: prices tax-inclusive (Aditya) · B: `tax_percent` added on top (Mohit) · C: inclusive, GST shown on invoice | **B — tax added on top. ✅ Decided by Aditya 2026-09-29** | Each product carries `tax_percent`; tax is computed per order line in paise (round half up) and added to the total, on **item lines only** (not the delivery fee), exactly as Mohit's order code does. Applies identically to online orders and POS sales. Consequences: supersedes CPSE decision D27; `lib/pricing.js` gains the tax step; `order_items` gains `tax_percent` + `tax_paise`; cart, checkout, receipt and merchant invoice show a GST line; the product page must say “+ GST” so the checkout total is not a surprise. The existing CHECK `total = subtotal − discount + fee + tax` already covers it. |
| **D-5 ✅** | **Stock authority** | A: decrement at placement (Aditya) · B: reserve on accept (Mohit) · C: reserve at placement + ledger | **C — reserve at placement, with Mohit's ledger. ✅ Decided by Aditya 2026-09-29** | Variant holds `quantity_on_hand` and `reserved_quantity`; available = on hand − reserved. Order placed (`create_order`) → reserve. Rejected / cancelled / unpaid-expired → release. Completed → deduct from on hand and release. POS sale → deduct on hand, may only sell *available* stock. Every movement writes an `inventory_ledger` row with its reason and reference. Fixes the current CPSE gap where a customer cancel or merchant reject never returns stock. |
| D-6 ✅ | Variants | optional (Aditya) · always ≥1 (Mohit) | **Always ≥1 variant**; a "simple" product gets one default variant — ✅ agreed 2026-09-29 | Stock, SKU and the ledger all key on `variant_id`. One rule is simpler than two code paths. The customer UI hides the selector when there is only one. |
| D-7 ✅ | Order states | Aditya's 9 · Mohit's 7 | **Aditya's 9** (§4.4) — ✅ agreed 2026-09-29 | Superset; the customer UI, notifications and payment flow depend on it. |
| D-8 ✅ | Opening hours storage | jsonb + timezone · `store_hours` rows | **jsonb + timezone**, holidays in `store_holidays` — ✅ agreed 2026-09-29 | Open/closed is computed server-side from it today (supports overnight and split shifts). Mohit's hours editor writes the jsonb. |
| D-9 ✅ | Frontend standard | JS · TS | **React + TypeScript** — ✅ agreed 2026-09-29 | Mohit's merchant app is already TS and moves in as-is. The customer app stays JS for now and is converted file-by-file when touched (Vite runs both). No big-bang rewrite. |
| D-10 ✅ | Image storage | local disk · Supabase Storage | **Supabase Storage** | Local disk does not survive a redeploy or scale past one server. |
| D-11 ✅ | API layout | — | Customer: `/api/v1/...` (unchanged). Merchant: `/api/v1/merchant/stores/:storeId/...` — ✅ agreed 2026-09-29 | Existing customer contract untouched; merchant routes grouped and role-gated in one place. |
| D-12 ✅ | Repository | new repo · CPSE repo | **CPSE repo** (optionally renamed / moved to an org); Merchant-One archived read-only — ✅ agreed 2026-09-29 | See §7. |

---

## 6. Target repository layout

```
<repo>/
  backend/                         Node/Express — the one backend
    migrations/                    0001–0023 existing, 0024+ merchant schema
    src/
      middleware/                  + requireRole, requireStoreOwner
      lib/                         pricing, openingHours … (shared)
      modules/
        auth/ stores/ orders/ …    existing customer + shared modules
        merchant/
          stores/  categories/  products/  inventory/
          orders/  purchases/   sales/     dashboard/
    tests/
    docs/API.md                    + merchant endpoints
  frontend/
    customer/                      current CPSE frontend (JS → TS gradually)
    merchant/                      Mohit's frontend (TS), storefront pages removed
  docs/
    MERGE_MAPPING.md               this file
```

---

## 7. Git and working process

- **No `git merge` of the two repositories.** Their histories are unrelated and a merge would put
  two backends side by side.
- **Baseline first.** Tag CPSE `main` as `v1.0-customer`; Mohit pushes any local changes and tags
  Merchant-One `v1.0-merchant`. Merchant-One is then archived (read-only) on GitHub, so its history
  and authorship stay intact.
- **Branch protection** on `main`: changes arrive by pull request only.
- **One branch and one PR per step** (§8), e.g. `integration/schema`, `integration/auth-roles`,
  `integration/merchant-products`.
- **Cross-review.** Mohit reviews every PR that ports his logic (he knows the business rules);
  Aditya reviews anything touching the customer path.
- **Credit.** Commits that port Mohit's code carry `Co-authored-by: Mohit <email>`.
- **A PR merges only when all tests pass**, including the route audit, which will require every
  `/merchant` route to be role-gated and store-scoped.

---

## 8. Integration order

| Step | Branch | Content | Done when |
|---|---|---|---|
| 0 | — | Baseline tags, branch protection, this doc signed off | D-1 … D-12 agreed |
| 1 | `integration/schema` | Migrations `0024+`: `merchants`, store owner + settings, holidays, payment preferences, variant fields, `inventory_ledger`, purchases/batches, sales; default variant backfill; `create_order` updated for D-5 | 749 existing tests still pass; new schema tests |
| 2 | `integration/auth-roles` | Merchant register/login on Supabase, `requireRole`, `requireStoreOwner`, route-audit rules | Cross-store and cross-role access refused in tests |
| 3 | `integration/merchant-stores` | Store CRUD, publish, hours, holidays, delivery, payment prefs, logo/cover | Customer store page reflects merchant edits |
| 4 | `integration/merchant-catalogue` | Categories + products + variants + images | Merchant-created product purchasable by a customer |
| 5 | `integration/merchant-inventory` | Stock in/out/adjust, ledger history | Ledger matches on-hand after every movement |
| 6 | `integration/merchant-orders` | List, detail, accept, reject, status, complete — through `transitionOrder`; delete `test-advance` | Customer notified on every merchant action |
| 7 | `integration/merchant-purchases` | Purchases, batches, expiring batches | |
| 8 | `integration/merchant-sales` | POS sales + invoices | |
| 9 | `integration/merchant-dashboard` | Metrics | |
| 10 | `integration/merchant-frontend` | Move Mohit's app to `frontend/merchant`, point it at `/api/v1/merchant`, Supabase tokens, remove storefront pages | Merchant can do every workflow in the UI |
| 11 | `integration/e2e` | Seed a merchant; full loop: customer orders → merchant accepts → customer notified → stock + ledger + dashboard update; docs updated; Docker/Flyway/Java retired | Walkthrough passes on a real device |

Mohit's 19 JUnit tests are re-written as vitest tests in the step that ports their module.

---

## 9. Risks and open questions

1. **Effort.** Steps 3–9 re-implement about 6.7k lines of Java. Realistically a few weeks, not days.
2. **Changing `create_order`** (D-5) touches the most carefully tested part of the customer path.
   It goes in step 1 on its own, before any merchant code depends on it.
3. **Existing data.** Supabase holds seed data only; Mohit's Docker database is local. Nothing needs
   migrating — confirm neither side has real merchant or customer data.
4. **Merchant ↔ customer events.** How does a merchant learn about a new order — polling,
   Supabase Realtime, or push? (Polling is enough to start.)
5. **Rejection reasons.** `cancellation_reason` is free text; a shared list would let the customer
   screen show a proper message.
6. **Discounts / coupons.** `discount_paise` exists on orders but nothing sets it. Out of scope for
   the merge.
7. **Merchant-side khata writes.** A new feature, planned after the merge.

---

## 10. Sign-off

| Name | Role | Agreed (date) | Comments |
|---|---|---|---|
| Aditya | Customer side | | |
| Mohit | Shopkeeper side | | |
| Lead | | | D-4 = B, D-5 = C decided by Aditya 2026-09-29 — lead to confirm |
