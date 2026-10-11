# Roadmap requirements matrix

Source: `Local_Commerce_Final_Development_Functional_Roadmap.docx` (8 pages).
Branch: `feature/roadmap-completion`. Updated with the merchant-app milestone (after commit `132e595`).

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
| Backend (api + sql + integration) | `cd backend && npx vitest run` | 49 files, **2085 passed**, 0 failed (2084 full run + the new khata store-view test, run in its file) |
| Customer app | `cd frontend/customer && npx vitest run` | 18 files, **584 passed** (same as baseline — customer screens for the new features are the next milestone) |
| Merchant app | `cd frontend/merchant && npx vitest run` | 10 files, **159 passed** (17 baseline + 142 new: API contract vs `backend/docs/API.md`, screen tests for every new screen, reviewer console) |
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
| M-05 | Units: piece, kg, g, litre, ml, box, packet, dozen and others, consistent quantity handling | IMPLEMENTED_NEEDS_TESTING | `product_unit` enum (0026: pcs, kg, g, l, ml, dozen, pack, box, …), `weight_grams` on variants; merchant product form | Customer-side price-per-kg display; unit conversion tests |
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
| M-20 | Communication preferences respected | PARTIAL | `customer_store_preferences` (0041); consent shown in CRM; senders check it (announcements, reminders, deliveries); IT; merchant sees consent in CRM (FE `relationships.test.tsx`) | Customer preference screen |
| M-21 | Digital Khata (merchant-controlled ledger) | VERIFIED | migration 0037, `src/modules/merchantKhata/*`; IT `khata.test.js`; FE KhataPage (accounts, statement, entries, settings); FE `operations.test.tsx` (idempotency key per entry, refusals) | — |
| M-22 | Khata statements (charges, payments, balance, due dates) | PARTIAL | merchant + customer statement endpoints; customer Khata screens exist (FE); merchant statement screen + FE tests | Customer khata screen to show the new entry kinds / due dates |
| M-23 | Due dates & reminders without rewriting history | VERIFIED | `khata_reminders`, opt-in auto reminders job; IT (reminder adds no ledger row); FE due date on credit, manual reminder (refusal shown), automatic reminders toggle; FE `operations.test.tsx`, `screens.test.tsx` (automation) | — |
| M-24 | Audit-safe corrections | VERIFIED | immutable + undeletable entries, linked reversals; IT (DB refuses update/delete, single reversal); FE Reverse with reason; adjustment needs a reason client- and server-side; FE `operations.test.tsx` | — |
| M-25 | Cancellation & refund settlement linked to order/payment, no lost history | PARTIAL | migrations 0038/0043, `src/modules/refunds/*`; IT `refunds.test.js` (15) + substitution adjustment refunds; merchant order detail RefundPanel (retry/confirm cash) + RefundsPage; FE `screens.test.tsx`, `operations.test.tsx` | Customer refund tracker UI |
| M-26 | Khata refund/adjustment as separate linked ledger event | VERIFIED | `refund_credit` entries linked to refund + order; IT; FE khata shows "Refund credited" and offers no reversal of it; FE `operations.test.tsx` | — |

## 4. Merchant side — P3 Loyalty, P4 Analytics, P5 Acquisition

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| M-27 | Merchant-specific loyalty rules | VERIFIED | migration 0042 `loyalty_programs`; IT `retention.test.js`; FE Promotions → Loyalty points; FE `relationships.test.tsx` | — |
| M-28 | Rewards created and granted | VERIFIED | rewards → personal coupon in one transaction; IT; FE rewards create/pause; FE `relationships.test.tsx` | Customer redemption UI is C-side |
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
| M-47 | Location-based offer banner | PARTIAL | `GET /offers/nearby`; IT (radius, nearest first) | Customer banner |
| M-48 | Automatic offer expiry (period, sold out, cut-off), server-side | VERIFIED | live check on every read + in `create_order`; expiry job; IT; FE offers list shows status and end reason, "End now"; FE `relationships.test.tsx` | — |
| M-49 | Notifications with delivery/status handling | VERIFIED (in-app) | merchant inbox (0036), `notification_deliveries`, channel provider boundary; IT; FE InboxPage (unread, mark read, open target); FE `operations.test.tsx` | External SMS/WhatsApp/email delivery **BLOCKED** (no vendor credentials); provider boundary exists |
| M-50 | Recurring operations | VERIFIED | `recurring_tasks`, job; IT (once per due time, store-time schedule); FE AutomationPage tasks (weekly/monthly need a day); FE `screens.test.tsx` | — |
| M-51 | Deterministic suggested purchase lists | VERIFIED | `GET …/purchase-suggestions`, draft conversion; IT; FE SuggestionsPage → draft purchase; FE `operations.test.tsx` | — |

## 4. Merchant side — Phase D/E Intelligence

| ID | Requirement | Status | Remaining |
|---|---|---|---|
| M-52 | Voice input → proposed structured actions | MISSING_OR_BROKEN | Deterministic command parser + browser speech input + confirm-before-apply |
| M-53 | Product recognition from images/scans | MISSING_OR_BROKEN | Barcode scan (browser) works with M-12 lookup once built; image recognition needs an AI provider (BLOCKED without `ANTHROPIC_API_KEY`) |
| M-54 | Invoice extraction | MISSING_OR_BROKEN | Text parser (deterministic) → draft purchase; image/PDF via AI provider (BLOCKED without key) |
| M-55 | Smart suggestions (categories, units, fields, related, actions) | MISSING_OR_BROKEN | Deterministic suggester |
| M-56 | Demand forecasting | MISSING_OR_BROKEN | Moving-average/day-of-week baseline with data-sufficiency checks |
| M-57 | Inventory intelligence (stockout risk, slow, over/under) | MISSING_OR_BROKEN | Days-of-cover analysis |
| M-58 | Privacy-safe cross-store insights | MISSING_OR_BROKEN | k-anonymous aggregates (≥5 stores) |
| M-59 | AI merchant assistant | MISSING_OR_BROKEN | Grounded Q&A over store data; actions proposed, confirmed |
| M-60 | AI rule: propose only; confirmation for consequential changes; manual fallback | MISSING_OR_BROKEN | Enforced by design of M-52…M-59 |

## 5. Customer side — P1 Commerce Foundation

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| C-01 | Registration/login | VERIFIED | `auth.test.js` (API), `auth*.test.jsx` (FE), existing screens | — |
| C-02 | Customer profile + basic shopping preferences | PARTIAL | profile VERIFIED (existing); preferences API + IT `relationship.test.js` | Preferences screen |
| C-03 | Store discovery via URL/QR | VERIFIED | store page, directory; `stores.test.js`, `store-page.test.jsx`; IT publish flow | — |
| C-04 | Store/catalogue browsing | VERIFIED | `catalogue.test.jsx`, `stores.test.js` | — |
| C-05 | Product search within store | VERIFIED | `store-search.test.jsx`, `stores.test.js` | — |
| C-06 | Product details (price, unit, availability, variants) | VERIFIED | `product-detail.test.jsx`, `productDetail.test.js` | — |
| C-07 | Availability prevents purchase | VERIFIED | cart issues + `create_order` lock; IT last-unit race | — |
| C-08 | Cart add/remove/update | VERIFIED | `cart.test.js`, `cart.test.jsx` | — |
| C-09 | Variants: each line correct SKU/price/availability | VERIFIED | IT `commerceFlow.test.js`; FE product detail | — |
| C-10 | Address management | VERIFIED | `addresses.test.js`, `addresses.test.jsx` | — |
| C-11 | Pickup/delivery selection | VERIFIED | `checkout.test.js`, `checkout.test.jsx` | — |
| C-12 | Checkout confirms items, price, fulfilment, address, charges | VERIFIED | quote endpoint + checkout screen tests | New quote fields (benefits, free-delivery progress) not yet shown |
| C-13 | Payment, reliably confirmed, never paid on client say-so | VERIFIED (simulated provider) | `payments.test.js`, `payment.test.jsx`, IT | Live gateway **BLOCKED** (only the mock provider; no gateway credentials) |
| C-14 | Exactly one order per confirmed checkout | VERIFIED | idempotency in `create_order`; IT duplicate key | — |
| C-15 | Clear order status | VERIFIED | `orders.test.jsx`, timeline | — |
| C-16 | Cancellation/rejection without inconsistent payment/order states | PARTIAL | refunds IT; order screen exists | Customer refund tracker UI for new fields |
| C-17 | Order history | VERIFIED | `orders.test.jsx` | — |
| C-18 | Persistent receipt | VERIFIED | `ReceiptPage`, `orderLifecycle.test.js` | Receipt shows refund (API done, UI pending) |
| C-19 | Reorder re-checks price and availability | VERIFIED | `orders.test.js` reorder; FE | — |
| C-20 | Notifications for payment/order/status | VERIFIED | `notifications.test.js`, FE notifications | — |
| C-21 | Multi-weight / multi-variant cart (1 kg + 500 g) | VERIFIED | IT `commerceFlow.test.js` (separate lines, SKUs, reservations), existing FE variant picker | — |
| C-22 | Checkout & payment step separation | VERIFIED | numbered checkout steps → order → separate payment page; `checkout.test.jsx`, `payment.test.jsx` | — |
| C-23 | Required flow end to end | IMPLEMENTED_NEEDS_TESTING | IT covers API chain; no browser-level E2E | Browser E2E run |

## 5. Customer side — P2 Effort reduction, P3 Relationship, P4 Retention

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| C-24 | Saved shops | VERIFIED | existing saved stores (API + FE) | — |
| C-25 | Buy again | PARTIAL | `GET /me/buy-again`; IT | Screen |
| C-26 | One-tap reorder (revalidated) | VERIFIED | existing reorder (API + FE) | — |
| C-27 | Shopping lists | PARTIAL | lists API; IT | Screen |
| C-28 | Shopping templates | PARTIAL | templates + reminders; IT | Screen |
| C-29 | Saved addresses | VERIFIED | existing | — |
| C-30 | Saved payment preference (no credentials) | PARTIAL | `preferred_payment_method`; IT refuses card fields | Screen |
| C-31 | Saved delivery preference | PARTIAL | `preferred_fulfilment`; quick checkout; IT | Screen |
| C-32 | Favourites / recently viewed / purchased | PARTIAL | APIs; IT (tracking off forgets) | Screens; event recording from the app |
| C-33 | Smart cart (deterministic) | PARTIAL | `GET /me/smart-cart`; IT | Screen |
| C-34 | Quick checkout | PARTIAL | `POST /checkout/quick`; IT | Screen |
| C-35 | Product/store sharing | MISSING_OR_BROKEN | — | Share buttons |
| C-36 | Follow/save merchant | VERIFIED | saved stores | — |
| C-37 | Ask the shop | PARTIAL | conversations; IT `messaging.test.js`; merchant Messages screen (FE `screens.test.tsx`) | Customer screens |
| C-38 | Special requests | PARTIAL | same; IT; merchant side in Messages | Customer screens |
| C-39 | Order messaging | PARTIAL | same; IT; merchant side in Messages | Customer screens |
| C-40 | Merchant-specific offers shown | PARTIAL | `GET /stores/:slug/offers`; IT | Store page section |
| C-41 | Communication preferences | PARTIAL | per-store preferences; IT | Screen |
| C-42 | Store-specific reorder & loyalty | PARTIAL | buy-again per store, loyalty per store; IT | Screens |
| C-43 | Store-specific notifications (opted-in) | PARTIAL | announcements; IT; merchant Announcements screen (FE `relationships.test.tsx`) | Customer opt-in screen (receipt uses the existing notifications screen) |
| C-44 | Merchant-specific loyalty benefits | PARTIAL | points at checkout; IT | Checkout UI |
| C-45 | Points & rewards history | PARTIAL | `GET /stores/:id/loyalty`; IT | Screen |
| C-46 | Coupons | PARTIAL | coupons + atomic limits; IT (expired, used-up race, per-customer); merchant Coupons screen (FE `screens.test.tsx`) | Checkout UI |
| C-47 | First-order / repeat benefits | PARTIAL | audiences `new`/`returning`; IT | UI |
| C-48 | Free pickup/delivery thresholds | PARTIAL | free-delivery threshold (existing) + `freeDelivery` progress in quote + free-delivery coupon; IT | Checkout UI |
| C-49 | Consent-based occasion offers | PARTIAL | birthday audience + consent; unit-tested window | UI |
| C-50 | Deterministic personalized offers | PARTIAL | `couponsForCustomer` (eligibility-ranked) | UI |
| C-51 | Reorder reminders | PARTIAL | job; IT | — (notification shown by existing screen) |
| C-52 | Favourite-store benefits | PARTIAL | `followers` and `loyal` audiences | UI |

## 5. Customer side — P5 Trust, P6 Intelligence foundation, P7 Assisted intelligence

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| C-53 | Accurate availability | VERIFIED | live stock on reads; reservation at order | — |
| C-54 | Transparent pricing & charges | VERIFIED | quote + "+ GST" (existing FE) | Discount lines in UI |
| C-55 | Explicit substitutions with approval | PARTIAL | migration 0043; IT (approve, decline, auto for allow_similar, never pays more); merchant propose/withdraw in order detail | Customer approve/decline UI |
| C-56 | Reliable payment confirmation | VERIFIED (simulated provider) | see C-13 | Live gateway BLOCKED |
| C-57 | Receipts & audit trail | VERIFIED | receipts, status history | — |
| C-58 | Refund/cancellation rules, eligibility, status | PARTIAL | `order.cancellation`, `order.refund`; IT | UI |
| C-59 | Merchant response status | VERIFIED | order timeline (existing) | — |
| C-60 | Order timeline | VERIFIED | `OrderTimeline.jsx`, tests | — |
| C-61 | Customer support / escalation | PARTIAL | escalation to platform; IT; reviewer console Escalated support (FE `admin.test.tsx`) | Customer screens |
| C-62 | Notification reliability | PARTIAL | delivery tracking; IT | External channels BLOCKED (no vendor) |
| C-63 | Refund tracking status (amount, times, reference, reason) | PARTIAL | `order.refund.events`, `nextStep`; IT | Customer UI |
| C-64 | Behaviour events | PARTIAL | `customer_events`, consent; IT | Recording from the customer app |
| C-65 | Deterministic customer metrics | PARTIAL | `GET /me/insights`; IT | Screen |
| C-66 | Natural-language search | MISSING_OR_BROKEN | — | Deterministic NL parser |
| C-67 | Smart basket generation | MISSING_OR_BROKEN | — | |
| C-68 | Shopping assistant (grounded) | MISSING_OR_BROKEN | — | |
| C-69 | Product recommendations | MISSING_OR_BROKEN | — | Co-purchase based |
| C-70 | Replenishment prediction | MISSING_OR_BROKEN | reorder-reminder rhythm exists as a base | Endpoint + UI |
| C-71 | Smart substitutions | MISSING_OR_BROKEN | — | |
| C-72 | Personalized discovery | MISSING_OR_BROKEN | — | |
| C-73 | Voice shopping | MISSING_OR_BROKEN | — | |
| C-74 | AI customer rule (returns to cart/checkout, no bypass) | MISSING_OR_BROKEN | — | By design of C-66…C-73 |

## 6. Shared commerce flows

| ID | Flow | Status | Evidence | Remaining |
|---|---|---|---|---|
| S-01 | Store publishing → URL/QR → customer opens | VERIFIED | IT publish + KYC; FE verification + reviewer console + Share (QR) screens with tests | — |
| S-02 | Catalogue → customer sees correct data | VERIFIED | existing apps + IT; import UI (M-10) | — |
| S-03 | Inventory → availability updates | VERIFIED | IT ledger + reservations; inventory, purchases and batches screens (FE tests) | — |
| S-04 | Order → merchant → status visible | VERIFIED | IT + both apps | — |
| S-05 | Sale → ledger once → history → analytics | VERIFIED | IT (ledger once, analytics totals); FE Reports screen (`relationships.test.tsx`) | — |
| S-06 | Customer relationship → CRM → reorder/favourites | PARTIAL | IT; merchant CRM screen (FE tests) | Customer favourites / buy-again / reminders UI |
| S-07 | Loyalty: rules → earn/redeem → consistent history | PARTIAL | IT; merchant loyalty + points history screens (FE tests) | Customer points/redeem UI in checkout |
| S-08 | Khata: record → customer visibility → audit | PARTIAL | IT; merchant khata screen (FE tests); customer khata screen (existing) | Customer screen: new entry kinds, due dates, reversals |
| S-09 | Notifications on business events | VERIFIED (in-app) | IT across modules; merchant inbox (FE tests); customer notifications screen (existing) | External channels BLOCKED (no vendor) |
| S-10 | Cancellation & refund reconciled across systems | PARTIAL | IT (`refunds.test.js`, `khata.test.js`, `messaging.test.js`); merchant refund screens (FE tests) | Customer refund tracker |

## 7. Engineering rules and 8. Definition of done

| ID | Rule | Status | Evidence |
|---|---|---|---|
| E-01 | Vertical slices | PARTIAL | Backend + merchant slices complete with tests; customer-app slices pending for new features |
| E-02 | Reuse shared concepts, no duplicates | VERIFIED | new features build on products/variants/orders/payments/ledger; one pricing engine |
| E-03 | Never trust client input | VERIFIED | Zod `.strict()` schemas on every route; route audit (1102 tests) |
| E-04 | Tenant isolation and customer ownership | VERIFIED (API) | route audit + isolation cases in every IT file |
| E-05 | Traceable inventory and financial records | VERIFIED | immutable ledgers (inventory, khata, loyalty, refund events, messages, verification events) |
| E-06 | Automation/AI propose, confirm important changes | PARTIAL | automation only notifies/drafts; AI not built |
| E-07 | Templates are defaults only | VERIFIED | IT (explicit values win, no overwrite on re-apply) |
| E-08 | Loading/empty/error/success states | PARTIAL | every new merchant screen uses Spinner / EmptyState / ErrorState (retry) / toasts; customer screens pending |
| E-09 | Failure paths tested | PARTIAL | backend thoroughly; merchant FE tests assert server refusals are shown (409/422/403/401); customer FE pending |
| E-10 | A screen is not a feature | — | rule respected: nothing marked VERIFIED without its screen |
| E-11 | Refund rule (paid cancellation linked & traceable) | VERIFIED (backend) | IT `refunds.test.js` |

## Summary at this update

| Status | Count |
|---|---|
| VERIFIED | 88 (incl. 2 "VERIFIED (simulated provider)", 2 "VERIFIED (in-app)", 1 "VERIFIED (API)", 1 "VERIFIED (backend)") |
| IMPLEMENTED_NEEDS_TESTING | 2 |
| PARTIAL | 45 |
| MISSING_OR_BROKEN | 19 |
| BLOCKED | 0 whole requirements (live payment gateway, external notification channels and AI image reading are blocked sub-parts, noted in their rows) |

Counted by script over the 154 rated rows (M-01…M-60, C-01…C-74, S-01…S-10, E-01…E-11, minus E-10, which is a rule about rating). VERIFIED: 88 / 154 = **57%** (was 39 / 154 = 25% at commit `132e595`). Every merchant-side requirement in §4 P1–P4 and Phase C is now VERIFIED except M-05 (customer-side unit display), M-20/M-22/M-25 (their remaining part is a customer screen) and M-47 (customer offer banner). The remaining PARTIAL rows are almost all "backend + merchant done, customer screen not built yet"; the MISSING rows are the AI / intelligence phase.

## Next incomplete requirement

Customer-app screens, in this order:

1. **C-63 / C-58 / C-16 / C-18 refund tracker** — order detail and receipt show the refund (amount, method, status timeline, reference, reason) from `GET /orders/:id` / `GET /me/refunds`.
2. **C-55 substitution approve/decline** on the order detail.
3. **C-44…C-48 checkout benefits** — coupon entry, points redemption, free-delivery progress, discount lines (C-54) from the quote.
4. **C-02 / C-30 / C-31 / C-41 / M-20 preferences and consent** screen.
5. **C-25 / C-27 / C-28 / C-32 / C-33 / C-34** buy again, lists, templates, favourites/recent, smart cart, quick checkout; **C-64** event recording.
6. **C-37…C-39 / C-61** ask the shop, special requests, order messages, support escalation.
7. **C-40 / C-47 / M-47 / C-49 / C-50 / C-52** store offers section and nearby-offers banner; **C-45** points history; **C-35** share buttons; **M-22 / S-08** khata entry kinds and due dates.

Then Phase D/E intelligence (M-52…M-60, C-66…C-74): deterministic engines first, with an optional Claude provider behind `AI_PROVIDER` (no key in this environment, so provider-backed parts will be reported BLOCKED rather than claimed).
