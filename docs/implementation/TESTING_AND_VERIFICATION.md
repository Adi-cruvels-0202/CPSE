# Testing and verification

Every number here is from a run on this branch (`feature/roadmap-completion`,
2026-10-14). Nothing is estimated.

## Results

| Suite | Command | Files | Tests | Result |
|---|---|---|---|---|
| Backend — api, sql, integration | `cd backend && npx vitest run` | 54 | 2257 | all pass |
| Customer app | `cd frontend/customer && npx vitest run` | 20 | 717 | all pass, on repeated full runs |
| Merchant app | `cd frontend/merchant && npx vitest run` | 12 | 190 | all pass |
| Merchant typecheck + build | `cd frontend/merchant && npm run build` | — | — | clean; main chunk 383 kB, tool and admin screens lazy-loaded |
| Customer build | `cd frontend/customer && npm run build` | — | — | clean |
| Merchant lint | `cd frontend/merchant && npx oxlint src tests` | — | — | 0 errors (warnings of the kinds the existing code already has) |

Baseline before this branch: backend 1344, customer 584, merchant 17.

## What each layer proves

**Backend, three Vitest projects.**

- `api` (`tests/*.test.js`, 42 files) — routes against an in-memory Supabase mock: validation (strict Zod, 422), authentication (401), roles (403 `MERCHANT_REQUIRED` / `SHOP_ACCOUNT`), ownership (404, never 403), envelopes. `routeAudit.test.js` walks **every mounted route**; `apiDocs.test.js` fails if any route is missing from `backend/docs/API.md`. `intelligence.test.js` is 38 unit tests of the deterministic engines (parsers, forecast, stock health, k-anonymity, invoice reading); `ai.test.js` tests the vision-model wrapper with the SDK mocked (image shrunk to 1280 px JPEG, fallback model, timeout, no retry on a refusal, non-JSON → 502).
- `sql` — the migrations themselves on PGlite: constraints, triggers, immutability of ledgers.
- `integration` (`tests/integration/*.test.js`, 12 files) — the real API on **real Postgres** (PGlite with every migration applied, through `tests/helpers/pgSupabase.js`): `commerceFlow`, `refunds`, `khata`, `verification`, `merchantOperations`, `relationship`, `retention`, `messaging`, `automation`, `intelligence`, `behaviourEvents`, `vision` (photo recognition and invoice files with a scripted model). They assert database rows directly (ledgers written once, stock moved once, reversals linked, no rows written by read-only endpoints).

**Frontends.**

- Contract tests (`frontend/merchant/tests/ops.test.ts`, `frontend/customer/tests/endpoints-contract.test.js`) call **every** client function and fail unless the method and path are documented in `backend/docs/API.md` — so the apps cannot call a route that does not exist. Each also checks it covers every exported function.
- Screen tests render the real screens with a fake HTTP transport answering with the backend's envelopes, act as a user would, and assert the exact request bodies sent, what is shown, and that server refusals (409/422/403/401/404) reach the user. Merchant: `screens`, `catalogue`, `relationships`, `operations`, `admin`, `intelligence`. Customer: `roadmap-customer` plus the existing suites.

## Checks that the tests can fail

- **Mutation checks:** removing `dayOfWeek` from the weekly task body, the "preview first" guard on bulk Apply, the 0.5 confidence threshold in photo recognition, and the add-to-cart call after a photo match at the till each made the corresponding test fail; restored, they pass.
- **The suite never calls a real model:** `tests/setup.js` forces `AI_PROVIDER=none` even when `backend/.env` sets a key (dotenv does not override). This was added after the first run of the new 503 test reached the real provider through `.env`.
- **Negative controls:** both contract tests assert their matcher rejects an undocumented path.
- **Read-only proofs:** the intelligence integration tests snapshot ledger, cart, order, purchase, price and visibility counts before and after every assistant, search, basket, invoice and command call, and require them unchanged; applying a proposal is a separate, explicit call.

## Phone-width check (real browser)

Both apps were run locally — the real backend and the production builds, on
the in-memory Postgres the integration tests use, seeded with a published shop,
10 products, past and open orders, a coupon, loyalty and a supplier — and every
screen was inspected in Chromium at **375 × 812** (mobile emulation, touch):
26 merchant screens and 21 customer screens, plus their tabs and the main
dialogs. Each page was checked for sideways page overflow, elements outside the
viewport, table cells too narrow to read, and error states; the dense screens
were also checked by eye.

Defects found and fixed (all confirmed on screen before and after):

| Where | Defect | Fix |
|---|---|---|
| Merchant, every dialog with three footer buttons (new purchase, message reply, reviewer decision) | the first button (Cancel) was pushed out of the dialog and could not be reached | `.dialog-footer` wraps (`frontend/merchant/src/styles/components.css`) |
| Merchant Insights → Stock & demand; What to reorder | columns squeezed to ~46 px; a sentence wrapped one word per line (rows 8–11 lines tall) | `.table-scroll`: 600 px minimum on phones, scrolling inside its frame (`Tools.css`) |
| Merchant counter sale | the ⌘K hint covered the camera-scan button | overlays move left of the camera button; the shortcut hint is hidden on touch screens (`Sales.css`) |
| Customer store page (and the same row in checkout, lists, messages) | the assistant's input + buttons row widened the page to 383 px | `.inline-form` lets the input shrink (`global.css`); these rows had reused the password-toggle layout |

Regression guards: merchant `tests/layout.test.tsx`, customer
`roadmap-customer.test.jsx` ("phone-width layout"). jsdom does no layout, so
these assert the rules and the classes the screens rely on; the pixel check is
the browser pass above. Not checked: real devices, other phone sizes, landscape,
and screens behind data the seed did not create (for example a khata account's
statement dialog).

## Browser walk-through (Playwright)

Run on 2026-10-14 with `playwright-cli` (Chromium) against the real backend
and production builds on local Postgres (PGlite, every migration, seeded shop),
with live Gemini for photos. The API rate limit was raised for the run
(`RATE_LIMIT_MAX`); the first sweep at the default limit hit 429s, which both
apps showed correctly as "Too many API requests" with Try again.

**Sweep.** Every route of both apps — 34 merchant (including the reviewer
console) and 22 customer pages, following in-app links to detail pages — at
1280 × 800 and 375 × 812: **0** console errors, uncaught page errors, failed
API calls, sideways overflow, off-screen controls or error banners.

**Flows, driven as a user would:**

| Flow | Checked |
|---|---|
| Customer: store → cart → checkout with coupon WELCOME10 → cash pickup order | discount ₹59.70, GST recomputed on the discounted line (₹8.78), total ₹546.08, same on the order page |
| Merchant: accept → preparing → ready → completed | each status reached the customer's timeline; cash marked paid; stock reduced; 5 points earned; receipt correct |
| Merchant counter sale | quantity capped at stock (1), charged INV-000001 ₹312.00, stock reduced |
| New product → Identify from photo (file picker) → Use these → save | product created with name and MRP from the photo |
| Purchases → invoice PDF → Use 3 lines → Receive stock | purchase confirmed; stock up (oil 10 → 16, dal 0 → 15, rice 1 kg 0 → 12); batches R-91 and SO-4 with expiries and costs |
| Customer: online payment (simulated) → cancel | refund opened by itself, shown to the customer and on the merchant's Refunds page |
| Customer ↔ shop message about an order | merchant inbox, reply, customer sees it and is notified |
| Reviewer console | verification and escalated-support queues load |

Found and fixed: the receipt footer said "Prices include tax" while GST is
added on top and shown as its own line; it now says so (customer
`roadmap-customer.test.jsx`).

## Photo reading against the live model

Run on 2026-10-14 against Google Gemini (`gemini-flash-lite-latest`) with the
owner's key, through the real backend on local Postgres (the seeded shop) —
first with `curl`, then through the merchant app in a browser. The images were
**rendered**, not camera photos: two product packs drawn as images, a typed
invoice as PNG, and the same invoice as a text PDF.

| Input | Result | Time |
|---|---|---|
| "India Gate Basmati Rice, Net Wt. 1 kg, MRP Rs. 140" pack | read correctly (confidence 0.99); matched the shop's Basmati Rice (1 kg) by name and size | 2.8 s |
| "Tata Salt, Iodised, 1 kg, MRP Rs. 28" pack (not sold by the shop) | no match; New product prefill "Tata Vacuum Evaporated Iodised Salt 1 kg", unit kg, weight 1000 g, MRP ₹28 | 1.9 s |
| A plain blue image | `isProduct: false` → "No product could be seen" | — |
| Invoice PNG, 3 lines with batch/expiry and a total | supplier matched to the saved one, number, date, all 3 lines, quantities, costs, batches and expiries correct; total ₹4,230 matched | 2.2 s |
| The same invoice as a PDF | identical result | 2.6 s |
| A PDF sent to recognition | 422 `IMAGE_INVALID` | — |
| Browser: New product → Identify from photo → Use these | name, unit, GST and MRP filled; nothing saved | — |
| Browser: till, 1 kg pack (out of stock in the seed) / 500 g pack | "…is out of stock." / added to the bill | — |
| Browser: Purchases → Read an invoice → photo | 2 lines matched with batch and expiry; supplier linked | — |

Not measured: real camera photos (glare, angles, partial labels), regional-language
packaging, handwritten bills, and accuracy over many products.

## Fixed during verification

- The order-conversation escalation the screens described did not exist; it was built (`escalateUnanswered`, job `support-escalation`) with integration tests.
- Two older checkout tests asserted on the quote immediately after the page heading appeared. Extra optional requests on checkout made that a race (about one full run in four); they now wait for the quote.
- `AI_PROVIDER=anthropic` was accepted by config but did nothing; config now accepts `none` or `gemini`, and `gemini` is implemented.
- At the till, a photo match for an out-of-stock pack silently filled the search box; it now says the item is out of stock (found in the browser check).

## Not verified here, and why

| What | Why |
|---|---|
| A browser end-to-end run of the full flow on a live project (C-23) | the Supabase project URL supplied does not resolve (NXDOMAIN) |
| A live payment gateway | only the mock provider exists |
| Real SMS / WhatsApp / email delivery | no vendor; attempts are recorded as `skipped` |
| Photo recognition and invoice photos on real camera images | checked on rendered images only (above) |
| Phone layouts on real devices (checked in desktop Chromium's mobile emulation only) | no device here |
| Camera barcode scanning on a real device | tested with a mocked `BarcodeDetector` and camera; needs a phone browser to see it work |
| Speech input on a real device | tested with a mocked `SpeechRecognition` |
