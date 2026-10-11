# Roadmap requirements matrix

Source: `Local_Commerce_Final_Development_Functional_Roadmap.docx` (8 pages).
Branch: `feature/roadmap-completion`. Updated after the gap fixes (invoice fields, cart events, phone-width check) on top of `a7765bc`.

## Status rules

| Status | Meaning |
|---|---|
| **VERIFIED** | Every applicable layer exists (database, API, rules, authorization, **frontend wired to the real API**, loading/empty/error/success states) and automated tests cover success and failure paths. |
| **IMPLEMENTED_NEEDS_TESTING** | Every layer exists, but test coverage of an important path is missing. |
| **PARTIAL** | Some layers are done (typically: database + API + database-backed tests) and others are not (typically: the screen). The "Remaining" column says what. |
| **MISSING_OR_BROKEN** | Not implemented. |
| **BLOCKED** | Needs an external credential or service that is not available here. |

Evidence paths are relative to `backend/` unless prefixed. "IT" = integration
test on real Postgres (`tests/integration/*`, PGlite with every migration);
"API" = route/contract test against the in-memory mock (`tests/*.test.js`);
"SQL" = migration-level test (`tests/*Sql.test.js`); "FE" = frontend test.

## Test evidence at this update

| Suite | Command | Result |
|---|---|---|
| Backend (api + sql + integration) | `cd backend && npx vitest run` | 52 files, **2228 passed**, 0 failed (full run) |
| Customer app | `cd frontend/customer && npx vitest run` | 20 files, **716 passed**, stable over repeated full runs (584 baseline + 132 new: endpoint contract vs `backend/docs/API.md`, screen tests for every new flow) |
| Customer build | `cd frontend/customer && npm run build` | clean |
| Merchant app | `cd frontend/merchant && npx vitest run` | 12 files, **182 passed** (17 baseline + 165 new: API contract vs `backend/docs/API.md`, screen tests for every new screen, reviewer console, intelligence) |
| Merchant typecheck + build | `cd frontend/merchant && npm run build` | clean; main chunk 374 kB, tools/admin lazy-loaded |
| Merchant lint | `cd frontend/merchant && npx oxlint src tests` | 0 errors (warnings only, same rule families as existing code) |

Baseline before this branch (historical, 2026-10-11): backend 1344, customer 584, merchant 17.

---

## 3. Development order (phases)

These are ordering rules, satisfied by the order of work on this branch; each phase's content is tracked below.

## 4. Merchant side — P1 Merchant Operations

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| M-01 | Store verification / KYC: details, GSTIN/GST certificate, shop photo, identity/business/address proof, Pending/Verified/Rejected, review & rejection reasons, publish only when verified | VERIFIED | migration 0039; `src/modules/verification/*`, `src/modules/admin/admin.routes.js`; IT `verification.test.js` (13 tests: publish gate incl. DB trigger, GSTIN rules, file sniffing, private bucket + signed links, review/reject/resubmit, revocation unpublishes, immutable audit, tenant isolation); FE `VerificationPage` (details, uploads, submit, field errors) + reviewer console `src/admin/AdminApp.tsx` at /merchant/admin; FE `operations.test.tsx` (verification), `admin.test.tsx` (approve, send back, incomplete cannot be approved, own session) | — |
| M-02 | Industry templates (Grocery, Pharmacy, Clothing, Electronics, Bakery, Stationery, General) with sensible defaults, not locking | VERIFIED | `src/lib/industryTemplates.js`; migration 0040 (`stationery`, store defaults); IT `merchantOperations.test.js` (apply, idempotent re-apply); FE Catalogue tools → Starter templates; FE `catalogue.test.tsx` (merchant prices, skipped report) | — |
| M-03 | Categories: create, rename, remove, activate/deactivate, reorder; shared with customer browsing | VERIFIED | existing create/rename/(de)activate (API `merchantCatalogue.test.js`, FE CategoriesPage); remove + reorder: migration 0040, IT; FE CategoriesPage reorder ↑↓ + delete with move/uncategorise; FE `catalogue.test.tsx` (order sent, move target, uncategorise, 409 shown) | — |
| M-04 | Product starter catalogues | VERIFIED | templates with starter products, merchant prices; IT; FE template product picker with per-size prices; FE `catalogue.test.tsx` | — |
| M-05 | Units: piece, kg, g, litre, ml, box, packet, dozen and others, consistent quantity handling | VERIFIED | `product_unit` enum (0026: pcs, kg, g, l, ml, dozen, pack, box, …), `weight_grams` on variants; merchant product form; `pricePerKgPaise` on public variants (`src/lib/pricing.js`, weight units only); API `pricing.test.js`, IT `commerceFlow.test.js`; customer product page shows ₹/kg per size; FE `roadmap-customer.test.jsx` | — |
| M-06 | Workflow defaults (inventory, availability, low-stock, purchase, operational) | VERIFIED | store defaults (0040), new products inherit; IT; FE Catalogue tools → Defaults; FE `catalogue.test.tsx` | — |
| M-07 | Purchase management: supplier, invoice/reference, date, product, quantity, price | VERIFIED | migration 0040 suppliers/purchases; `src/modules/merchantPurchases/*`; IT (draft→confirm, duplicate invoice 409, isolation); FE PurchasesPage (suppliers, draft, receive); FE `operations.test.tsx` (receive body, duplicate-invoice refusal) | — |
| M-08 | Batch & expiry; expiring/expired visible; feeds alerts and offers | VERIFIED | `inventory_batches`, FEFO trigger, `GET …/inventory/batches`; IT (FEFO on sale, targeted write-off, expiring list), alerts IT; FE BatchesPage (expiring/expired, FEFO note, write-off, clearance offer); FE `operations.test.tsx` | — |
| M-09 | Inventory ledger: confirmed purchase → traceable movement | VERIFIED | `inventory_ledger` (0028) + `purchase` movements (0040); IT asserts referenced rows; FE purchase entry → confirmed movement (backend IT); FE `operations.test.tsx` | — |
| M-10 | Import/export with validation and error reporting | VERIFIED | `src/modules/merchantCatalogue/bulk.service.js`, `src/lib/csv.js`; IT (preview, failed-line report, whole-product skip, re-import by SKU, formula neutralising); FE Catalogue tools → Import & export (preview first, failed lines, commit, CSV download); FE `screens.test.tsx`, `ops.test.ts` | — |
| M-11 | Duplicate/reuse | VERIFIED | `POST …/products/:id/duplicate`; IT; FE Products → Duplicate (opens the hidden copy); FE `catalogue.test.tsx` | — |
| M-12 | Barcode support: store, identify, search, future scanning | VERIFIED | unique barcode per store (0040), `GET …/product-lookup`, search matches barcode/SKU; IT; FE counter sale: Enter/scan matches barcode/SKU locally, else `product-lookup`; FE `catalogue.test.tsx` (local, server, not found) | Camera scanning (browser BarcodeDetector) is optional future work |
| M-13 | Bulk operations with validation, preview, failed-row reporting | VERIFIED | `POST …/products/bulk`; IT (preview without writes, per-product MRP failure, foreign ids); FE Catalogue tools → Bulk changes (preview → apply, failed products listed, Apply blocked when none can change); FE `screens.test.tsx`, `relationships.test.tsx` | — |
| M-14 | Required flow: setup → catalogue → purchase → validation → ledger → batch/expiry → stock visibility → customer availability | VERIFIED | IT chain across `merchantOperations`, `commerceFlow`; every step now has a screen with FE tests (templates, catalogue, purchases, batches, stock, products); backend chain IT | — |

## 4. Merchant side — P2 CRM & Khata & Refunds

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| M-15 | Per-merchant customer CRM | VERIFIED | `src/modules/crm/*`; IT `relationship.test.js` (store-scoped figures, isolation); FE CustomersPage; FE `relationships.test.tsx` | — |
| M-16 | Purchase history at that merchant | VERIFIED | CRM detail `purchaseHistory`; IT; FE customer detail "Recent orders"; FE `relationships.test.tsx` | — |
| M-17 | Customer status (new/active/loyal/inactive), deterministic | VERIFIED | `src/lib/customerSegments.js`; unit IT; FE group filter + badges; FE `relationships.test.tsx` | — |
| M-18 | Customer value: total spend, first/last order | VERIFIED | `customerValue`; IT; FE spend/average/first-last; FE `relationships.test.tsx` | — |
| M-19 | Favourite products (repeat + explicit) | VERIFIED | CRM `favouriteProducts`; IT; FE "Buys again and again"; FE `relationships.test.tsx` | — |
| M-20 | Communication preferences respected | VERIFIED | `customer_store_preferences` (0041); consent shown in CRM; senders check it (announcements, reminders, deliveries); IT; merchant sees consent in CRM (FE `relationships.test.tsx`); customer Preferences + per-shop consent; FE `roadmap-customer.test.jsx` | — |
| M-21 | Digital Khata (merchant-controlled ledger) | VERIFIED | migration 0037, `src/modules/merchantKhata/*`; IT `khata.test.js`; FE KhataPage (accounts, statement, entries, settings); FE `operations.test.tsx` (idempotency key per entry, refusals) | — |
| M-22 | Khata statements (charges, payments, balance, due dates) | VERIFIED | merchant + customer statement endpoints; customer Khata screens exist (FE); merchant statement screen + FE tests; customer khata statement shows entry kind, due date, payment method; FE `roadmap-customer.test.jsx` | — |
| M-23 | Due dates & reminders without rewriting history | VERIFIED | `khata_reminders`, opt-in auto reminders job; IT (reminder adds no ledger row); FE due date on credit, manual reminder (refusal shown), automatic reminders toggle; FE `operations.test.tsx`, `screens.test.tsx` (automation) | — |
| M-24 | Audit-safe corrections | VERIFIED | immutable + undeletable entries, linked reversals; IT (DB refuses update/delete, single reversal); FE Reverse with reason; adjustment needs a reason client- and server-side; FE `operations.test.tsx` | — |
| M-25 | Cancellation & refund settlement linked to order/payment, no lost history | VERIFIED | migrations 0038/0043, `src/modules/refunds/*`; IT `refunds.test.js` (15) + substitution adjustment refunds; merchant order detail RefundPanel (retry/confirm cash) + RefundsPage; FE `screens.test.tsx`, `operations.test.tsx`; customer refund tracker; FE `roadmap-customer.test.jsx` | — |
| M-26 | Khata refund/adjustment as separate linked ledger event | VERIFIED | `refund_credit` entries linked to refund + order; IT; FE khata shows "Refund credited" and offers no reversal of it; FE `operations.test.tsx` | — |

## 4. Merchant side — P3 Loyalty, P4 Analytics, P5 Acquisition

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| M-27 | Merchant-specific loyalty rules | VERIFIED | migration 0042 `loyalty_programs`; IT `retention.test.js`; FE Promotions → Loyalty points; FE `relationships.test.tsx` | — |
| M-28 | Rewards created and granted | VERIFIED | rewards → personal coupon in one transaction; IT; FE rewards create/pause; FE `relationships.test.tsx`; customer redemption on Points screen | — |
| M-29 | Loyalty history (earn/redeem) | VERIFIED | immutable `loyalty_ledger`; IT; FE points history + adjust (refusal shown) in customer detail; FE `relationships.test.tsx` | — |
| M-30 | Sales analytics (totals, trends) | VERIFIED | `src/modules/analytics/*`; IT checks against independent SQL totals; FE AnalyticsPage (period presets/custom, daily bars); FE `relationships.test.tsx` | — |
| M-31 | Order analytics (count, status patterns) | VERIFIED | same; IT; FE AnalyticsPage; FE `relationships.test.tsx` | — |
| M-32 | Best-selling products | VERIFIED | same; IT; FE AnalyticsPage; FE `relationships.test.tsx` | — |
| M-33 | Slow-moving products | VERIFIED | same; IT; FE AnalyticsPage; FE `relationships.test.tsx` | — |
| M-34 | Unavailable products | VERIFIED | same; IT; FE AnalyticsPage "Missed sales"; FE `relationships.test.tsx` | — |
| M-35 | Customer segments | VERIFIED | same; IT; FE AnalyticsPage + CRM groups; FE `relationships.test.tsx` | — |
| M-36 | Khata analytics (outstanding, collected, overdue) | VERIFIED | same; IT; FE AnalyticsPage khata card; FE `relationships.test.tsx` | — |
| M-37 | Analytics reproducible, defined periods/filters, no double counting, no AI | VERIFIED | `definitions` in response; IT asserts trend sums = totals, cancelled excluded; FE "How these numbers are counted" shows server definitions; FE `relationships.test.tsx` (error state too) | — |
| M-38 | Public store URL | VERIFIED | `/store/:slug`, `publicPath`; FE store page; `PUBLIC_APP_URL` env; FE SharePage absolute link `origin/store/<slug>`; FE `screens.test.tsx` | — |
| M-39 | QR generation | VERIFIED | `qrcode.react` dependency present, not used; FE SharePage `QRCodeCanvas` encodes the store link; FE `screens.test.tsx` | — |
| M-40 | Download/print QR | VERIFIED | —; FE Download QR (PNG) and Print poster; FE `screens.test.tsx` | — |
| M-41 | WhatsApp/share actions | VERIFIED | —; FE WhatsApp share + native share; FE `screens.test.tsx` | — |
| M-42 | Map/location | VERIFIED | customer `StoreLocation.jsx` (existing); FE map link from store coordinates; FE `screens.test.tsx` | — |
| M-43 | Reusable merchant sharing experience | VERIFIED | —; FE SharePage (one place: link, QR, WhatsApp, map); FE `screens.test.tsx` | — |

## 4. Merchant side — Phase C Automation

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| M-44 | Low-stock alerts | VERIFIED | job + `GET …/low-stock`; IT (once per variant per day); FE InboxPage (low stock → What to reorder) + Automation low-stock list; FE `operations.test.tsx`, `screens.test.tsx` | — |
| M-45 | Expiry alerts | VERIFIED | job; IT (expiring and expired, once each); FE InboxPage (batch alerts → Batches) + BatchesPage; FE `operations.test.tsx` | — |
| M-46 | Expiry-based local offers (product, price, validity, location) | VERIFIED | `store_offers` (0042), `src/modules/offers/*`; IT (batch cap, cut-off refusal); FE OfferForm (from a batch or any product); FE `relationships.test.tsx` (batch-tied body, cut-off refusal) | — |
| M-47 | Location-based offer banner | VERIFIED | `GET /offers/nearby`; IT (radius, nearest first); Home "Offers near you" (location only on tap, rounded, no token); FE `roadmap-customer.test.jsx` | — |
| M-48 | Automatic offer expiry (period, sold out, cut-off), server-side | VERIFIED | live check on every read + in `create_order`; expiry job; IT; FE offers list shows status and end reason, "End now"; FE `relationships.test.tsx` | — |
| M-49 | Notifications with delivery/status handling | VERIFIED (in-app) | merchant inbox (0036), `notification_deliveries`, channel provider boundary; IT; FE InboxPage (unread, mark read, open target); FE `operations.test.tsx` | External SMS/WhatsApp/email delivery **BLOCKED** (no vendor credentials); provider boundary exists |
| M-50 | Recurring operations | VERIFIED | `recurring_tasks`, job; IT (once per due time, store-time schedule); FE AutomationPage tasks (weekly/monthly need a day); FE `screens.test.tsx` | — |
| M-51 | Deterministic suggested purchase lists | VERIFIED | `GET …/purchase-suggestions`, draft conversion; IT; FE SuggestionsPage → draft purchase; FE `operations.test.tsx` | — |

## 4. Merchant side — Phase D/E Intelligence

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| M-52 | Voice input → proposed structured actions | VERIFIED | `src/modules/intelligence/*` (deterministic, read-only): `parseMerchantCommand` → proposal naming the ordinary endpoint; browser speech input (feature-detected) on Insights → Ask; Confirm applies it; API `intelligence.test.js`, IT `integration/intelligence.test.js` (applied only after confirmation), FE merchant `intelligence.test.tsx` | — |
| M-53 | Product recognition from images/scans | BLOCKED | camera barcode scanning at the till via the browser BarcodeDetector + `product-lookup` (FE merchant `intelligence.test.tsx`); barcode/SKU lookup VERIFIED under M-12 | Recognising a product from a photo needs an AI vision provider: none configured, and adding `@anthropic-ai/sdk` would rewrite `backend/package-lock.json`, which holds uncommitted changes I was told not to touch |
| M-54 | Invoice extraction | VERIFIED (text invoices) | pasted text → supplier (labelled or heading line, matched to saved suppliers), invoice number, invoice date, products, quantities, prices, **batch/lot and expiry per line** (`parseInvoiceText`, `extractBatchAndExpiry` in `backend/src/modules/intelligence/engines.js`); impossible dates and malformed batches are left empty with a warning, never guessed; already-expired lines warned; batch, expiry and supplier carried into the draft purchase (Purchases → Read an invoice). API `intelligence.test.js` (supplier, batch, 6 expiry formats, 4 invalid dates, invalid invoice date, existing lines unchanged), IT `integration/intelligence.test.js` (supplier match, batch/expiry, nothing written), FE merchant `intelligence.test.tsx` (prefilled supplier, batch, expiry; invalid-expiry warning shown) | Photo/PDF invoices BLOCKED: need an AI provider (see M-53); the screen says so |
| M-55 | Smart suggestions (categories, units, fields, related, actions) | VERIFIED | `suggestForProduct` (store products first, then templates; category, unit, size, GST, duplicates, each with a reason); "Suggest" in New product, applied only on "Use these"; IT `integration/intelligence.test.js`, FE merchant `intelligence.test.tsx` | — |
| M-56 | Demand forecasting | VERIFIED | `forecastDemand`: 28-day average shaped by weekday, confidence levels, refuses under 14 days / 3 selling days; Insights → Stock & demand; API `intelligence.test.js`, IT `integration/intelligence.test.js`, FE merchant `intelligence.test.tsx` | — |
| M-57 | Inventory intelligence (stockout risk, slow, over/under) | VERIFIED | `stockHealth`: days of cover, stock-out / at risk / overstock / slow, proposed reorder quantity; API `intelligence.test.js`, IT `integration/intelligence.test.js`, FE merchant `intelligence.test.tsx` | — |
| M-58 | Privacy-safe cross-store insights | VERIFIED | `areaInsights`: price spread and popular-nearby only from ≥5 other shops in the city, one figure per shop, never named; API `intelligence.test.js` (k-anonymity), IT `integration/intelligence.test.js` (4 shops → nothing, 5 → spread), FE merchant `intelligence.test.tsx` | — |
| M-59 | AI merchant assistant | VERIFIED | grounded assistant `askAssistant` (sales, best/slow sellers, low stock, forecast, khata, open orders) with its source, commands → proposals; no model involved; IT `integration/intelligence.test.js` (row counts unchanged), FE merchant `intelligence.test.tsx` | An optional LLM phrasing layer is not built (would need the SDK; see M-53) |
| M-60 | AI rule: propose only; confirmation for consequential changes; manual fallback | VERIFIED | every intelligence endpoint only reads; proposals need Confirm and go through the ordinary endpoint (scoped to the caller's store client-side and server-side); IT `integration/intelligence.test.js` asserts ledger/cart/orders/purchases/prices unchanged; FE merchant `intelligence.test.tsx` | — |

## 5. Customer side — P1 Commerce Foundation

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| C-01 | Registration/login | VERIFIED | `auth.test.js` (API), `auth*.test.jsx` (FE), existing screens | — |
| C-02 | Customer profile + basic shopping preferences | VERIFIED | profile VERIFIED (existing); preferences API + IT `relationship.test.js`; customer Preferences screen (`/account/preferences`); FE `roadmap-customer.test.jsx` | — |
| C-03 | Store discovery via URL/QR | VERIFIED | store page, directory; `stores.test.js`, `store-page.test.jsx`; IT publish flow | — |
| C-04 | Store/catalogue browsing | VERIFIED | `catalogue.test.jsx`, `stores.test.js` | — |
| C-05 | Product search within store | VERIFIED | `store-search.test.jsx`, `stores.test.js` | — |
| C-06 | Product details (price, unit, availability, variants) | VERIFIED | `product-detail.test.jsx`, `productDetail.test.js` | — |
| C-07 | Availability prevents purchase | VERIFIED | cart issues + `create_order` lock; IT last-unit race | — |
| C-08 | Cart add/remove/update | VERIFIED | `cart.test.js`, `cart.test.jsx` | — |
| C-09 | Variants: each line correct SKU/price/availability | VERIFIED | IT `commerceFlow.test.js`; FE product detail | — |
| C-10 | Address management | VERIFIED | `addresses.test.js`, `addresses.test.jsx` | — |
| C-11 | Pickup/delivery selection | VERIFIED | `checkout.test.js`, `checkout.test.jsx` | — |
| C-12 | Checkout confirms items, price, fulfilment, address, charges | VERIFIED | quote endpoint + checkout screen tests; checkout shows coupon/points lines, waived delivery, free-delivery progress from the quote; FE `roadmap-customer.test.jsx` | — |
| C-13 | Payment, reliably confirmed, never paid on client say-so | VERIFIED (simulated provider) | `payments.test.js`, `payment.test.jsx`, IT | Live gateway **BLOCKED** (only the mock provider; no gateway credentials) |
| C-14 | Exactly one order per confirmed checkout | VERIFIED | idempotency in `create_order`; IT duplicate key | — |
| C-15 | Clear order status | VERIFIED | `orders.test.jsx`, timeline | — |
| C-16 | Cancellation/rejection without inconsistent payment/order states | VERIFIED | refunds IT; order screen exists; order page refund tracker + cancellation rule and refund destination before cancelling; FE `roadmap-customer.test.jsx` | — |
| C-17 | Order history | VERIFIED | `orders.test.jsx` | — |
| C-18 | Persistent receipt | VERIFIED | `ReceiptPage`, `orderLifecycle.test.js`; receipt Refund block (amount, destination, status, reference); FE `roadmap-customer.test.jsx` | — |
| C-19 | Reorder re-checks price and availability | VERIFIED | `orders.test.js` reorder; FE | — |
| C-20 | Notifications for payment/order/status | VERIFIED | `notifications.test.js`, FE notifications | — |
| C-21 | Multi-weight / multi-variant cart (1 kg + 500 g) | VERIFIED | IT `commerceFlow.test.js` (separate lines, SKUs, reservations), existing FE variant picker | — |
| C-22 | Checkout & payment step separation | VERIFIED | numbered checkout steps → order → separate payment page; `checkout.test.jsx`, `payment.test.jsx` | — |
| C-23 | Required flow end to end | BLOCKED | IT covers the whole API chain on real Postgres (`commerceFlow.test.js` and the per-feature IT files); every screen of the flow has FE tests in both apps | A browser run against a live stack needs a Supabase project: there is no `backend/.env` here and no credentials were provided |

## 5. Customer side — P2 Effort reduction, P3 Relationship, P4 Retention

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| C-24 | Saved shops | VERIFIED | existing saved stores (API + FE) | — |
| C-25 | Buy again | VERIFIED | `GET /me/buy-again`; IT; My shopping → Buy again (usual size and quantity); FE `roadmap-customer.test.jsx` | — |
| C-26 | One-tap reorder (revalidated) | VERIFIED | existing reorder (API + FE) | — |
| C-27 | Shopping lists | VERIFIED | lists API; IT; Lists screens (free text + products, tick, put in cart with report); FE `roadmap-customer.test.jsx` | — |
| C-28 | Shopping templates | VERIFIED | templates + reminders; IT; templates need a shop, optional reminder every N days; FE `roadmap-customer.test.jsx` | — |
| C-29 | Saved addresses | VERIFIED | existing | — |
| C-30 | Saved payment preference (no credentials) | VERIFIED | `preferred_payment_method`; IT refuses card fields; Preferences (method name only) + quick checkout applies it; FE `roadmap-customer.test.jsx` | — |
| C-31 | Saved delivery preference | VERIFIED | `preferred_fulfilment`; quick checkout; IT; Preferences + quick checkout; FE `roadmap-customer.test.jsx` | — |
| C-32 | Favourites / recently viewed / purchased | VERIFIED | APIs; IT (tracking off forgets); My shopping tabs (buy again by recency, favourites, recently viewed), heart on product page; FE `roadmap-customer.test.jsx` | — |
| C-33 | Smart cart (deterministic) | VERIFIED | `GET /me/smart-cart`; IT; cart "You usually also get" + add missing, failures reported; FE `roadmap-customer.test.jsx` | — |
| C-34 | Quick checkout | VERIFIED | `POST /checkout/quick`; IT; cart "Quick checkout" → review pre-filled from `POST /checkout/quick`; FE `roadmap-customer.test.jsx` | — |
| C-35 | Product/store sharing | VERIFIED | —; Share / WhatsApp on store page, Share on product page (native share or copy); FE `roadmap-customer.test.jsx` | — |
| C-36 | Follow/save merchant | VERIFIED | saved stores | — |
| C-37 | Ask the shop | VERIFIED | conversations; IT `messaging.test.js`; merchant Messages screen (FE `screens.test.tsx`); "Ask the shop" (store page), "Ask about this" (product page), Messages screens; FE `roadmap-customer.test.jsx` | — |
| C-38 | Special requests | VERIFIED | same; IT; merchant side in Messages; special request with type; FE `roadmap-customer.test.jsx` | — |
| C-39 | Order messaging | VERIFIED | same; IT; merchant side in Messages; "Message the shop about this order" + thread replies; FE `roadmap-customer.test.jsx` | — |
| C-40 | Merchant-specific offers shown | VERIFIED | `GET /stores/:slug/offers`; IT; store page "Offers here" (live offers + coupons); FE `roadmap-customer.test.jsx` | — |
| C-41 | Communication preferences | VERIFIED | per-store preferences; IT; Preferences per-shop toggles + on the store page; FE `roadmap-customer.test.jsx` | — |
| C-42 | Store-specific reorder & loyalty | VERIFIED | buy-again per store, loyalty per store; IT; per-shop points page, store-page link, buy again; FE `roadmap-customer.test.jsx` | — |
| C-43 | Store-specific notifications (opted-in) | VERIFIED | announcements; IT; merchant Announcements screen (FE `relationships.test.tsx`); per-shop opt-in screen; FE `roadmap-customer.test.jsx` | — |
| C-44 | Merchant-specific loyalty benefits | VERIFIED | points at checkout; IT; checkout "Use my points", clamped to the quote's cap; FE `roadmap-customer.test.jsx` | — |
| C-45 | Points & rewards history | VERIFIED | `GET /stores/:id/loyalty`; IT; Points screens (balance, rewards, history, redeem → coupon); FE `roadmap-customer.test.jsx` | — |
| C-46 | Coupons | VERIFIED | coupons + atomic limits; IT (expired, used-up race, per-customer); merchant Coupons screen (FE `screens.test.tsx`); checkout coupon entry + eligible coupons as chips, refusal shown and removable; FE `roadmap-customer.test.jsx` | — |
| C-47 | First-order / repeat benefits | VERIFIED | audiences `new`/`returning`; IT; eligibility decided by the server (audiences); the app shows the customer's eligible coupons; FE `roadmap-customer.test.jsx` | — |
| C-48 | Free pickup/delivery thresholds | VERIFIED | free-delivery threshold (existing) + `freeDelivery` progress in quote + free-delivery coupon; IT; checkout free-delivery progress; FE `roadmap-customer.test.jsx` | — |
| C-49 | Consent-based occasion offers | VERIFIED | birthday audience + consent; unit-tested window; Preferences: birthday offers opt-in, month/day only; FE `roadmap-customer.test.jsx` | — |
| C-50 | Deterministic personalized offers | VERIFIED | `couponsForCustomer` (eligibility-ranked); personal coupons from `GET /stores/:slug/offers` shown on store page and checkout; FE `roadmap-customer.test.jsx` | — |
| C-51 | Reorder reminders | VERIFIED | job; IT; templates carry the reminder rhythm; reminders arrive in Notifications; FE `roadmap-customer.test.jsx` | — |
| C-52 | Favourite-store benefits | VERIFIED | `followers` and `loyal` audiences; follower-audience coupons shown the same way; FE `roadmap-customer.test.jsx` | — |

## 5. Customer side — P5 Trust, P6 Intelligence foundation, P7 Assisted intelligence

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| C-53 | Accurate availability | VERIFIED | live stock on reads; reservation at order | — |
| C-54 | Transparent pricing & charges | VERIFIED | quote + "+ GST" (existing FE); coupon/points discount lines in checkout and order; FE `roadmap-customer.test.jsx` | — |
| C-55 | Explicit substitutions with approval | VERIFIED | migration 0043; IT (approve, decline, auto for allow_similar, never pays more); merchant propose/withdraw in order detail; order page accept/decline with note, refusal shown; FE `roadmap-customer.test.jsx` | — |
| C-56 | Reliable payment confirmation | VERIFIED (simulated provider) | see C-13 | Live gateway BLOCKED |
| C-57 | Receipts & audit trail | VERIFIED | receipts, status history | — |
| C-58 | Refund/cancellation rules, eligibility, status | VERIFIED | `order.cancellation`, `order.refund`; IT; cancellation rule + refund method before cancelling, tracker after; FE `roadmap-customer.test.jsx` | — |
| C-59 | Merchant response status | VERIFIED | order timeline (existing) | — |
| C-60 | Order timeline | VERIFIED | `OrderTimeline.jsx`, tests | — |
| C-61 | Customer support / escalation | VERIFIED | escalation to platform; IT; reviewer console Escalated support (FE `admin.test.tsx`); customer escalation (order/support only), automatic escalation after 24 h (backend `escalateUnanswered`, IT `messaging.test.js`), reviewer console; FE `roadmap-customer.test.jsx` | — |
| C-62 | Notification reliability | VERIFIED (in-app) | in-app notification on every event, delivery records with retries and backoff (`runDeliveries`), `GET /notifications/:id/deliveries`; IT | External SMS/WhatsApp/email BLOCKED (no vendor credentials); attempts are recorded as skipped, never claimed sent |
| C-63 | Refund tracking status (amount, times, reference, reason) | VERIFIED | `order.refund.events`, `nextStep`; IT; refund tracker (amount, method, status timeline, reference, reason); FE `roadmap-customer.test.jsx` | — |
| C-64 | Behaviour events | VERIFIED | `customer_events` with consent. Views and searches from the app (`frontend/customer/src/lib/track.js`); **cart additions recorded by the server** when a line is saved (`recordCartAdd`, `backend/src/modules/engagement/cartEvents.js`, every add path); **abandoned carts** by the `abandoned-carts` job (`recordAbandonedCarts`: open cart with items, idle ≥ 24 h and ≤ 30 days, not ordered since, once per idle spell via unique `dedupe_key`, migration `0044_cart_behaviour_events.sql`); favourites and list saves from the server; purchases, repeats and saved shops come from their own tables (orders, saved_stores), not duplicated as events. Clients cannot post `cart_add`/`cart_abandon` (422). No prices or personal details in either. IT `integration/behaviourEvents.test.js` (10: once per add, nothing on a refused add, list path, tracking off, event failure never fails the add, client posting refused, 401/403, once per spell, concurrent runs, recent/empty/ordered/old/untracked carts excluded, DB dedupe), FE `roadmap-customer.test.jsx` | — |
| C-65 | Deterministic customer metrics | VERIFIED | `GET /me/insights`; IT; "Your shopping at a glance" in My shopping; FE `roadmap-customer.test.jsx` | — |
| C-66 | Natural-language search | VERIFIED | `GET /stores/:slug/smart-search` (size, budget, cheapest, on offer) shown as "Understood as …" in store search; API `intelligence.test.js`, IT `integration/intelligence.test.js`, FE customer `roadmap-customer.test.jsx` | — |
| C-67 | Smart basket generation | VERIFIED | `POST /stores/:storeId/basket/propose` (usual size when none written) and the shop assistant's list handling; "Add all" through the cart with failures reported; IT `integration/intelligence.test.js`, FE customer `roadmap-customer.test.jsx` | — |
| C-68 | Shopping assistant (grounded) | VERIFIED | `POST /stores/:slug/assistant` on the store page: hours, delivery, offers, my usual, lists, comparisons, search — answers with sources, proposals only; IT `integration/intelligence.test.js`, FE customer `roadmap-customer.test.jsx` | — |
| C-69 | Product recommendations | VERIFIED | bought together from ≥2 shared completed orders (180 days), then same category; product page "Often bought with this"; IT `integration/intelligence.test.js`, FE customer `roadmap-customer.test.jsx` | — |
| C-70 | Replenishment prediction | VERIFIED | `GET /me/replenishment` (median gap, due/soon/later); My shopping → Due again; IT `integration/intelligence.test.js`, FE customer `roadmap-customer.test.jsx` | — |
| C-71 | Smart substitutions | VERIFIED | `alternatives` engine: customer product page ("Instead, try" when sold out) and the merchant's substitution picker (★ suggested first); IT `integration/intelligence.test.js`, FE customer `roadmap-customer.test.jsx`, FE merchant `intelligence.test.tsx` | — |
| C-72 | Personalized discovery | VERIFIED | `GET /me/discover` (new-to-you from your categories, else popular here) on the store page; IT `integration/intelligence.test.js`, FE customer `roadmap-customer.test.jsx` | — |
| C-73 | Voice shopping | VERIFIED | browser speech input (feature-detected, en-IN) into the shop assistant, which handles single items and whole lists; FE customer `roadmap-customer.test.jsx` | — |
| C-74 | AI customer rule (returns to cart/checkout, no bypass) | VERIFIED | assistants and search return proposals; adding uses `POST /cart/items`, ordering needs checkout; IT `integration/intelligence.test.js` asserts no cart/order rows created; FE customer `roadmap-customer.test.jsx` (nothing added until "Add all") | — |

## 6. Shared commerce flows

| ID | Flow | Status | Evidence | Remaining |
|---|---|---|---|---|
| S-01 | Store publishing → URL/QR → customer opens | VERIFIED | IT publish + KYC; FE verification + reviewer console + Share (QR) screens with tests | — |
| S-02 | Catalogue → customer sees correct data | VERIFIED | existing apps + IT; import UI (M-10) | — |
| S-03 | Inventory → availability updates | VERIFIED | IT ledger + reservations; inventory, purchases and batches screens (FE tests) | — |
| S-04 | Order → merchant → status visible | VERIFIED | IT + both apps | — |
| S-05 | Sale → ledger once → history → analytics | VERIFIED | IT (ledger once, analytics totals); FE Reports screen (`relationships.test.tsx`) | — |
| S-06 | Customer relationship → CRM → reorder/favourites | VERIFIED | IT; merchant CRM screen (FE tests); customer favourites / buy again / usual basket / reminders; FE `roadmap-customer.test.jsx` | — |
| S-07 | Loyalty: rules → earn/redeem → consistent history | VERIFIED | IT; merchant loyalty + points history screens (FE tests); customer points in checkout and history; FE `roadmap-customer.test.jsx` | — |
| S-08 | Khata: record → customer visibility → audit | VERIFIED | IT; merchant khata screen (FE tests); customer khata screen (existing); customer statement with entry kinds; FE `roadmap-customer.test.jsx` | — |
| S-09 | Notifications on business events | VERIFIED (in-app) | IT across modules; merchant inbox (FE tests); customer notifications screen (existing) | External channels BLOCKED (no vendor) |
| S-10 | Cancellation & refund reconciled across systems | VERIFIED | IT (`refunds.test.js`, `khata.test.js`, `messaging.test.js`); merchant refund screens (FE tests); customer refund tracker; FE `roadmap-customer.test.jsx` | — |

## 7. Engineering rules and 8. Definition of done

| ID | Rule | Status | Evidence |
|---|---|---|---|
| E-01 | Vertical slices | VERIFIED | every feature, intelligence included, is a full slice (DB → API → both apps → tests); the blocked sub-parts are named in their rows |
| E-02 | Reuse shared concepts, no duplicates | VERIFIED | new features build on products/variants/orders/payments/ledger; one pricing engine |
| E-03 | Never trust client input | VERIFIED | Zod `.strict()` schemas on every route; route audit (1102 tests) |
| E-04 | Tenant isolation and customer ownership | VERIFIED (API) | route audit + isolation cases in every IT file |
| E-05 | Traceable inventory and financial records | VERIFIED | immutable ledgers (inventory, khata, loyalty, refund events, messages, verification events) |
| E-06 | Automation/AI propose, confirm important changes | VERIFIED | automation notifies and drafts; intelligence only proposes, applied on Confirm through the ordinary endpoint; IT proves no writes |
| E-07 | Templates are defaults only | VERIFIED | IT (explicit values win, no overwrite on re-apply) |
| E-08 | Loading/empty/error/success states | VERIFIED | every new screen in both apps has loading, empty, error (with retry) and success states; FE tests exercise them. Definition of Done "responsive UI": every merchant (26) and customer (21) screen inspected at 375 × 812 in a real browser on seeded data — 4 defects found and fixed (see TESTING_AND_VERIFICATION.md), regression guards in FE merchant `layout.test.tsx` and customer `roadmap-customer.test.jsx` |
| E-09 | Failure paths tested | VERIFIED | backend thoroughly; FE tests in both apps assert server refusals reach the user (409/422/403/401/404) |
| E-10 | A screen is not a feature | — | rule respected: nothing marked VERIFIED without its screen |
| E-11 | Refund rule (paid cancellation linked & traceable) | VERIFIED (backend) | IT `refunds.test.js` |

## Summary at this update

| Status | Count |
|---|---|
| VERIFIED | 152 (incl. 2 "VERIFIED (simulated provider)", 3 "VERIFIED (in-app)", 1 "VERIFIED (text invoices)", 1 "VERIFIED (API)", 1 "VERIFIED (backend)") |
| BLOCKED | 2 — M-53 image recognition (no AI provider) and C-23 browser end-to-end run (no Supabase project here) |
| IMPLEMENTED_NEEDS_TESTING | 0 |
| PARTIAL | 0 |
| MISSING_OR_BROKEN | 0 |

Counted by script over the 154 rated rows (M-01…M-60, C-01…C-74, S-01…S-10, E-01…E-11, minus E-10). VERIFIED: 152 / 154 = **98.7%**; the other two are BLOCKED, each by a missing external credential or service named in its row.

**Correction to the previous update.** The same count (152) was reported before, but a re-read of the roadmap against the code showed three rows overstated: M-54 did not extract supplier, batch or expiry; C-64 did not record cart additions or abandoned carts; and the Definition of Done's "responsive UI" had not been checked in a browser. All three are now implemented and verified; the count is unchanged because those rows had already been counted as verified — they are now actually verified.

A matrix count is not completion: several VERIFIED rows carry qualifiers (simulated payment provider, in-app notifications only, text invoices only), listed below.

**Not 100%, and why.** Blocked sub-parts that no code change here can unblock:

- a live payment gateway (C-13, C-56 run against the simulated provider);
- SMS / WhatsApp / email delivery (M-49, S-09, C-62 are verified in-app; external attempts are recorded as skipped);
- AI image reading (M-53 photo recognition, M-54 photo/PDF invoices) and an optional LLM layer for the assistants (M-59). Using Claude needs the official `@anthropic-ai/sdk`, and installing it rewrites `backend/package-lock.json`, which holds uncommitted changes I was told not to touch. `AI_PROVIDER` stays `none`, and everything listed works without it;
- the browser end-to-end run (C-23), which needs a Supabase project and `backend/.env`.

## Next incomplete requirement

None that can be built here. With credentials:
1. **C-23** — run the required flow in a browser against a live stack (`backend/.env` from `.env.example`, `npm run dev`).
2. **M-53 / M-54 images / M-59 LLM** — with permission to add `@anthropic-ai/sdk` (and the lockfile change), implement the `anthropic` provider behind `AI_PROVIDER`, keeping proposals and confirmation exactly as now.
3. **Payment gateway, SMS/WhatsApp/email vendor** — plug real providers into the existing provider boundaries.
