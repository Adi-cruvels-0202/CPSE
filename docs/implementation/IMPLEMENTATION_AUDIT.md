# Implementation audit

What `feature/roadmap-completion` adds to implement
`Local_Commerce_Final_Development_Functional_Roadmap.docx`, how it is built,
and what is left. Requirement-by-requirement status and evidence:
[ROADMAP_REQUIREMENTS_MATRIX.md](ROADMAP_REQUIREMENTS_MATRIX.md) — **152 of 154
verified, 2 blocked** by missing external credentials.

## Rules every feature follows

- **One source of truth per fact.** Money is integer paise; prices, totals,
  discounts, refunds and analytics are computed on the server by one engine
  (`src/lib/pricing.js`, the quote), never re-derived by a screen.
- **Append-only records.** Inventory, khata, loyalty, refund events,
  verification events and messages are never edited or deleted (database
  triggers enforce it); corrections are new, linked rows.
- **Atomic writes in SQL.** Multi-row changes (orders, stock movements,
  purchases, substitutions, refunds, point postings, reward redemption) are
  single Postgres functions.
- **Tenant isolation.** Every merchant route passes `requireStoreOwner`; a
  store that is not yours is a 404. Customer data is read through the
  customer's own id only. Cross-store figures need at least 5 contributing
  shops, one figure per shop.
- **Strict input.** Every route validates params, query and body with
  `.strict()` Zod schemas.
- **Proposals, not actions.** Automation notifies and drafts; intelligence
  answers and proposes. Nothing changes until a person confirms, through the
  ordinary endpoint.
- **Idempotent jobs.** Each scheduled job takes a lease (`acquire_job_lease`),
  is safe to re-run, and logs its run.

## What was added

### Database (migrations 0036–0044)

Notifications and deliveries, merchant khata, refunds, store verification,
merchant operations (suppliers, purchases, FEFO batches, defaults), customer
relationship (consent, events, favourites, lists), loyalty/coupons/offers,
messaging/substitutions/jobs, cart behaviour events. Details: `ENVIRONMENT_AND_SETUP.md`.

### Backend modules (`backend/src/modules`)

refunds, merchantKhata, verification, admin, merchantCatalogue operations
(templates, import/export, bulk, duplicate, lookup), merchantPurchases,
offers, benefits, loyalty, crm, engagement, messaging (with automatic
escalation), substitutions, automation, analytics, intelligence. All routes
are documented in `backend/docs/API.md`.

### Merchant app (`frontend/merchant`)

A "More" hub with: inbox, customer messages, refunds, purchases (with
invoice reading), batches & expiry, what to reorder, catalogue tools,
customers, khata, loyalty/coupons/offers, announcements, reports,
automation, insights (demand, stock health, assistant with voice, area
benchmarks), share (link, QR, WhatsApp, map) and verification. Also order
refunds and substitutions, category order/delete, product duplicate and
suggestions, barcode and camera scanning at the till, and a platform
reviewer console at `/merchant/admin` with its own session.

### Customer app (`frontend/customer`)

Refund tracker and substitution approval on orders, refund on receipts,
coupons/points/khata/free-delivery and substitution choice at checkout,
quick checkout and the usual basket, my shopping (due again, buy again,
favourites, recently viewed, habits), lists and templates, preferences and
per-shop consent, points and rewards, messages and support, store offers,
ask/share, shop assistant (lists and voice), plain-words search, product
recommendations and alternatives, nearby offers, price per kg, activity
events (signed in, consent respected).

## Decisions worth knowing

- **No AI SDK.** Every intelligence feature is deterministic. Claude support
  needs `@anthropic-ai/sdk`, and installing it would rewrite
  `backend/package-lock.json`, which holds the owner's uncommitted changes
  that were not to be touched. `AI_PROVIDER` accepts only `none` until that
  is decided.
- **Reviewer console inside the merchant app.** It is mounted at
  `/merchant/admin` with a separate localStorage session
  (`cpse.admin.session`), so a reviewer and a shop owner in the same browser
  never sign each other out.
- **Share links are same-origin.** The customer app lives at `/` and the
  merchant app at `/merchant/` on one origin, so a shop's link is
  `origin/store/<slug>`.
- **Per-kg price only for weights.** `weight_grams` holds grams, so liquids
  are not given a per-litre figure.

## Remaining

| Item | Blocked by |
|---|---|
| Browser end-to-end run (C-23) | a Supabase project and `backend/.env` |
| Photo product recognition (M-53), photo/PDF invoices (M-54 part) | an AI provider and the SDK dependency |
| Live payments, SMS/WhatsApp/email | provider credentials |

Uncommitted files outside this work were left as they were:
`backend/package-lock.json`, `frontend/customer/package-lock.json`,
`frontend/merchant/package-lock.json`, the roadmap `.docx` and `.DS_Store`
files. Nothing has been pushed.
