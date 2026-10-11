# Roadmap requirements matrix

Source: `Local_Commerce_Final_Development_Functional_Roadmap.docx` (8 pages).
Branch: `feature/roadmap-completion`. Updated after commit `de8d9bb`.

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
| Backend (api + sql + integration) | `cd backend && npx vitest run` | 49 files, **2084 passed**, 0 failed |
| Customer app | `cd frontend/customer && npx vitest run` | 18 files, **584 passed** (same count as the baseline before this branch — no new customer screens yet) |
| Merchant app | `cd frontend/merchant && npx vitest run` | 4 files, **17 passed** (same as baseline) |
| Merchant typecheck | `cd frontend/merchant && npx tsc -b` | clean |

Baseline before this branch (historical, 2026-10-11): backend 1344, customer 584, merchant 17.

---

## 3. Development order (phases)

These are ordering rules, satisfied by the order of work on this branch; each phase's content is tracked below.

## 4. Merchant side — P1 Merchant Operations

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| M-01 | Store verification / KYC: details, GSTIN/GST certificate, shop photo, identity/business/address proof, Pending/Verified/Rejected, review & rejection reasons, publish only when verified | PARTIAL | migration 0039; `src/modules/verification/*`, `src/modules/admin/admin.routes.js`; IT `verification.test.js` (13 tests: publish gate incl. DB trigger, GSTIN rules, file sniffing, private bucket + signed links, review/reject/resubmit, revocation unpublishes, immutable audit, tenant isolation) | Merchant verification screen; reviewer (admin) screens |
| M-02 | Industry templates (Grocery, Pharmacy, Clothing, Electronics, Bakery, Stationery, General) with sensible defaults, not locking | PARTIAL | `src/lib/industryTemplates.js`; migration 0040 (`stationery`, store defaults); IT `merchantOperations.test.js` (apply, idempotent re-apply) | Template picker screen |
| M-03 | Categories: create, rename, remove, activate/deactivate, reorder; shared with customer browsing | PARTIAL | existing create/rename/(de)activate (API `merchantCatalogue.test.js`, FE CategoriesPage); remove + reorder: migration 0040, IT | Reorder and delete in the merchant Categories screen |
| M-04 | Product starter catalogues | PARTIAL | templates with starter products, merchant prices; IT | Selection screen |
| M-05 | Units: piece, kg, g, litre, ml, box, packet, dozen and others, consistent quantity handling | IMPLEMENTED_NEEDS_TESTING | `product_unit` enum (0026: pcs, kg, g, l, ml, dozen, pack, box, …), `weight_grams` on variants; merchant product form | Customer-side price-per-kg display; unit conversion tests |
| M-06 | Workflow defaults (inventory, availability, low-stock, purchase, operational) | PARTIAL | store defaults (0040), new products inherit; IT | Defaults screen |
| M-07 | Purchase management: supplier, invoice/reference, date, product, quantity, price | PARTIAL | migration 0040 suppliers/purchases; `src/modules/merchantPurchases/*`; IT (draft→confirm, duplicate invoice 409, isolation) | Purchases screens |
| M-08 | Batch & expiry; expiring/expired visible; feeds alerts and offers | PARTIAL | `inventory_batches`, FEFO trigger, `GET …/inventory/batches`; IT (FEFO on sale, targeted write-off, expiring list), alerts IT | Batch/expiry screen |
| M-09 | Inventory ledger: confirmed purchase → traceable movement | PARTIAL | `inventory_ledger` (0028) + `purchase` movements (0040); IT asserts referenced rows | Purchase entry in merchant UI (ledger screen exists) |
| M-10 | Import/export with validation and error reporting | PARTIAL | `src/modules/merchantCatalogue/bulk.service.js`, `src/lib/csv.js`; IT (preview, failed-line report, whole-product skip, re-import by SKU, formula neutralising) | Import/export screen |
| M-11 | Duplicate/reuse | PARTIAL | `POST …/products/:id/duplicate`; IT | Button in Products screen |
| M-12 | Barcode support: store, identify, search, future scanning | PARTIAL | unique barcode per store (0040), `GET …/product-lookup`, search matches barcode/SKU; IT | Scan/lookup in POS and Products screens |
| M-13 | Bulk operations with validation, preview, failed-row reporting | PARTIAL | `POST …/products/bulk`; IT (preview without writes, per-product MRP failure, foreign ids) | Bulk-action UI |
| M-14 | Required flow: setup → catalogue → purchase → validation → ledger → batch/expiry → stock visibility → customer availability | PARTIAL | IT chain across `merchantOperations`, `commerceFlow` | Merchant UI for purchases/batches |

## 4. Merchant side — P2 CRM & Khata & Refunds

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| M-15 | Per-merchant customer CRM | PARTIAL | `src/modules/crm/*`; IT `relationship.test.js` (store-scoped figures, isolation) | CRM screens |
| M-16 | Purchase history at that merchant | PARTIAL | CRM detail `purchaseHistory`; IT | Screen |
| M-17 | Customer status (new/active/loyal/inactive), deterministic | PARTIAL | `src/lib/customerSegments.js`; unit IT | Screen |
| M-18 | Customer value: total spend, first/last order | PARTIAL | `customerValue`; IT | Screen |
| M-19 | Favourite products (repeat + explicit) | PARTIAL | CRM `favouriteProducts`; IT | Screen |
| M-20 | Communication preferences respected | PARTIAL | `customer_store_preferences` (0041); consent shown in CRM; senders check it (announcements, reminders, deliveries); IT | Customer preference screen |
| M-21 | Digital Khata (merchant-controlled ledger) | PARTIAL | migration 0037, `src/modules/merchantKhata/*`; IT `khata.test.js` | Merchant khata screens |
| M-22 | Khata statements (charges, payments, balance, due dates) | PARTIAL | merchant + customer statement endpoints; customer Khata screens exist (FE) | Merchant statement screen; customer screen shows new fields |
| M-23 | Due dates & reminders without rewriting history | PARTIAL | `khata_reminders`, opt-in auto reminders job; IT (reminder adds no ledger row) | Screens |
| M-24 | Audit-safe corrections | PARTIAL | immutable + undeletable entries, linked reversals; IT (DB refuses update/delete, single reversal) | Screen |
| M-25 | Cancellation & refund settlement linked to order/payment, no lost history | PARTIAL | migrations 0038/0043, `src/modules/refunds/*`; IT `refunds.test.js` (15) + substitution adjustment refunds | Merchant refunds screen; customer refund tracker UI |
| M-26 | Khata refund/adjustment as separate linked ledger event | PARTIAL | `refund_credit` entries linked to refund + order; IT | Screen |

## 4. Merchant side — P3 Loyalty, P4 Analytics, P5 Acquisition

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| M-27 | Merchant-specific loyalty rules | PARTIAL | migration 0042 `loyalty_programs`; IT `retention.test.js` | Screen |
| M-28 | Rewards created and granted | PARTIAL | rewards → personal coupon in one transaction; IT | Screen |
| M-29 | Loyalty history (earn/redeem) | PARTIAL | immutable `loyalty_ledger`; IT | Screen |
| M-30 | Sales analytics (totals, trends) | PARTIAL | `src/modules/analytics/*`; IT checks against independent SQL totals | Analytics screen |
| M-31 | Order analytics (count, status patterns) | PARTIAL | same; IT | Screen |
| M-32 | Best-selling products | PARTIAL | same; IT | Screen |
| M-33 | Slow-moving products | PARTIAL | same; IT | Screen |
| M-34 | Unavailable products | PARTIAL | same; IT | Screen |
| M-35 | Customer segments | PARTIAL | same; IT | Screen |
| M-36 | Khata analytics (outstanding, collected, overdue) | PARTIAL | same; IT | Screen |
| M-37 | Analytics reproducible, defined periods/filters, no double counting, no AI | PARTIAL | `definitions` in response; IT asserts trend sums = totals, cancelled excluded | Screen |
| M-38 | Public store URL | IMPLEMENTED_NEEDS_TESTING | `/store/:slug`, `publicPath`; FE store page; `PUBLIC_APP_URL` env | Absolute share URL in merchant UI |
| M-39 | QR generation | MISSING_OR_BROKEN | `qrcode.react` dependency present, not used | Share screen |
| M-40 | Download/print QR | MISSING_OR_BROKEN | — | Share screen |
| M-41 | WhatsApp/share actions | MISSING_OR_BROKEN | — | Share screen |
| M-42 | Map/location | IMPLEMENTED_NEEDS_TESTING | customer `StoreLocation.jsx` (existing) | Map link in merchant share screen; tests |
| M-43 | Reusable merchant sharing experience | MISSING_OR_BROKEN | — | Share screen |

## 4. Merchant side — Phase C Automation

| ID | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| M-44 | Low-stock alerts | PARTIAL | job + `GET …/low-stock`; IT (once per variant per day) | Inbox screen |
| M-45 | Expiry alerts | PARTIAL | job; IT (expiring and expired, once each) | Inbox screen |
| M-46 | Expiry-based local offers (product, price, validity, location) | PARTIAL | `store_offers` (0042), `src/modules/offers/*`; IT (batch cap, cut-off refusal) | Offer creation screen |
| M-47 | Location-based offer banner | PARTIAL | `GET /offers/nearby`; IT (radius, nearest first) | Customer banner |
| M-48 | Automatic offer expiry (period, sold out, cut-off), server-side | PARTIAL | live check on every read + in `create_order`; expiry job; IT | — (UI shows state) |
| M-49 | Notifications with delivery/status handling | PARTIAL | merchant inbox (0036), `notification_deliveries`, channel provider boundary; IT | Inbox screen; external channel **BLOCKED** (no SMS/WhatsApp/email vendor) |
| M-50 | Recurring operations | PARTIAL | `recurring_tasks`, job; IT (once per due time, store-time schedule) | Screen |
| M-51 | Deterministic suggested purchase lists | PARTIAL | `GET …/purchase-suggestions`, draft conversion; IT | Screen |

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
| C-03 | Store discovery via URL/QR | VERIFIED | store page, directory; `stores.test.js`, `store-page.test.jsx`; IT publish flow | (QR is M-39) |
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
| C-37 | Ask the shop | PARTIAL | conversations; IT `messaging.test.js` | Screens (both apps) |
| C-38 | Special requests | PARTIAL | same; IT | Screens |
| C-39 | Order messaging | PARTIAL | same; IT | Screens |
| C-40 | Merchant-specific offers shown | PARTIAL | `GET /stores/:slug/offers`; IT | Store page section |
| C-41 | Communication preferences | PARTIAL | per-store preferences; IT | Screen |
| C-42 | Store-specific reorder & loyalty | PARTIAL | buy-again per store, loyalty per store; IT | Screens |
| C-43 | Store-specific notifications (opted-in) | PARTIAL | announcements; IT | Merchant announce screen |
| C-44 | Merchant-specific loyalty benefits | PARTIAL | points at checkout; IT | Checkout UI |
| C-45 | Points & rewards history | PARTIAL | `GET /stores/:id/loyalty`; IT | Screen |
| C-46 | Coupons | PARTIAL | coupons + atomic limits; IT (expired, used-up race, per-customer) | Checkout UI, merchant coupon screen |
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
| C-55 | Explicit substitutions with approval | PARTIAL | migration 0043; IT (approve, decline, auto for allow_similar, never pays more) | Customer approve/decline UI; merchant propose UI |
| C-56 | Reliable payment confirmation | VERIFIED (simulated provider) | see C-13 | Live gateway BLOCKED |
| C-57 | Receipts & audit trail | VERIFIED | receipts, status history | — |
| C-58 | Refund/cancellation rules, eligibility, status | PARTIAL | `order.cancellation`, `order.refund`; IT | UI |
| C-59 | Merchant response status | VERIFIED | order timeline (existing) | — |
| C-60 | Order timeline | VERIFIED | `OrderTimeline.jsx`, tests | — |
| C-61 | Customer support / escalation | PARTIAL | escalation to platform; IT | Screens |
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
| S-01 | Store publishing → URL/QR → customer opens | PARTIAL | IT publish + KYC | QR, verification UI |
| S-02 | Catalogue → customer sees correct data | VERIFIED | existing apps + IT | Import UI (M-10) |
| S-03 | Inventory → availability updates | VERIFIED | IT ledger + reservations; inventory screens | Purchases UI |
| S-04 | Order → merchant → status visible | VERIFIED | IT + both apps | — |
| S-05 | Sale → ledger once → history → analytics | PARTIAL | IT (ledger once, analytics totals) | Analytics UI |
| S-06 | Customer relationship → CRM → reorder/favourites | PARTIAL | IT | UIs |
| S-07 | Loyalty: rules → earn/redeem → consistent history | PARTIAL | IT | UIs |
| S-08 | Khata: record → customer visibility → audit | PARTIAL | IT | Merchant UI |
| S-09 | Notifications on business events | PARTIAL | IT across modules | Merchant inbox UI |
| S-10 | Cancellation & refund reconciled across systems | PARTIAL | IT (`refunds.test.js`, `khata.test.js`, `messaging.test.js`) | Refund UIs |

## 7. Engineering rules and 8. Definition of done

| ID | Rule | Status | Evidence |
|---|---|---|---|
| E-01 | Vertical slices | PARTIAL | Backend slices complete with tests; frontend slices pending for new features |
| E-02 | Reuse shared concepts, no duplicates | VERIFIED | new features build on products/variants/orders/payments/ledger; one pricing engine |
| E-03 | Never trust client input | VERIFIED | Zod `.strict()` schemas on every route; route audit (1102 tests) |
| E-04 | Tenant isolation and customer ownership | VERIFIED (API) | route audit + isolation cases in every IT file |
| E-05 | Traceable inventory and financial records | VERIFIED | immutable ledgers (inventory, khata, loyalty, refund events, messages, verification events) |
| E-06 | Automation/AI propose, confirm important changes | PARTIAL | automation only notifies/drafts; AI not built |
| E-07 | Templates are defaults only | VERIFIED | IT (explicit values win, no overwrite on re-apply) |
| E-08 | Loading/empty/error/success states | PARTIAL | existing screens; new screens pending |
| E-09 | Failure paths tested | PARTIAL | backend thoroughly; frontend pending |
| E-10 | A screen is not a feature | — | rule respected: nothing marked VERIFIED without its screen |
| E-11 | Refund rule (paid cancellation linked & traceable) | VERIFIED (backend) | IT `refunds.test.js` |

## Summary at this update

| Status | Count |
|---|---|
| VERIFIED | 39 (incl. 2 "VERIFIED (simulated provider)", 1 "VERIFIED (API)", 1 "VERIFIED (backend)") |
| IMPLEMENTED_NEEDS_TESTING | 4 |
| PARTIAL | 88 |
| MISSING_OR_BROKEN | 23 |
| BLOCKED | 0 whole requirements (live payment gateway, external notification channels and AI image reading are blocked sub-parts, noted in their rows) |

Counted by script over the 154 rated rows (M-01…M-60, C-01…C-74, S-01…S-10, E-01…E-11, minus E-10, which is a rule about rating). VERIFIED: 39 / 154 = **25%**. The large PARTIAL block is almost entirely "backend + database tests done, screen not built yet".

## Next incomplete requirement

Merchant-app screens for the backend now in place, starting with **M-25 / C-63 refund visibility** (merchant order detail + refunds list; customer refund tracker), then M-01 verification, M-21 khata, M-07/M-08 purchases & batches, M-30 analytics, and the merchant inbox (M-49).
