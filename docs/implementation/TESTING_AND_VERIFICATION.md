# Testing and verification

Every number here is from a run on this branch (`feature/roadmap-completion`,
2026-10-11). Nothing is estimated.

## Results

| Suite | Command | Files | Tests | Result |
|---|---|---|---|---|
| Backend — api, sql, integration | `cd backend && npx vitest run` | 52 | 2228 | all pass |
| Customer app | `cd frontend/customer && npx vitest run` | 20 | 716 | all pass, on repeated full runs |
| Merchant app | `cd frontend/merchant && npx vitest run` | 12 | 182 | all pass |
| Merchant typecheck + build | `cd frontend/merchant && npm run build` | — | — | clean; main chunk 379 kB, tool and admin screens lazy-loaded |
| Customer build | `cd frontend/customer && npm run build` | — | — | clean |
| Merchant lint | `cd frontend/merchant && npx oxlint src tests` | — | — | 0 errors (warnings of the kinds the existing code already has) |

Baseline before this branch: backend 1344, customer 584, merchant 17.

## What each layer proves

**Backend, three Vitest projects.**

- `api` (`tests/*.test.js`, 41 files) — routes against an in-memory Supabase mock: validation (strict Zod, 422), authentication (401), roles (403 `MERCHANT_REQUIRED` / `SHOP_ACCOUNT`), ownership (404, never 403), envelopes. `routeAudit.test.js` walks **every mounted route**; `apiDocs.test.js` fails if any route is missing from `backend/docs/API.md`. `intelligence.test.js` is 38 unit tests of the deterministic engines (parsers, forecast, stock health, k-anonymity, invoice reading).
- `sql` — the migrations themselves on PGlite: constraints, triggers, immutability of ledgers.
- `integration` (`tests/integration/*.test.js`, 11 files) — the real API on **real Postgres** (PGlite with every migration applied, through `tests/helpers/pgSupabase.js`): `commerceFlow`, `refunds`, `khata`, `verification`, `merchantOperations`, `relationship`, `retention`, `messaging`, `automation`, `intelligence`, `behaviourEvents`. They assert database rows directly (ledgers written once, stock moved once, reversals linked, no rows written by read-only endpoints).

**Frontends.**

- Contract tests (`frontend/merchant/tests/ops.test.ts`, `frontend/customer/tests/endpoints-contract.test.js`) call **every** client function and fail unless the method and path are documented in `backend/docs/API.md` — so the apps cannot call a route that does not exist. Each also checks it covers every exported function.
- Screen tests render the real screens with a fake HTTP transport answering with the backend's envelopes, act as a user would, and assert the exact request bodies sent, what is shown, and that server refusals (409/422/403/401/404) reach the user. Merchant: `screens`, `catalogue`, `relationships`, `operations`, `admin`, `intelligence`. Customer: `roadmap-customer` plus the existing suites.

## Checks that the tests can fail

- **Mutation checks (merchant):** removing `dayOfWeek` from the weekly task body, and removing the "preview first" guard on bulk Apply, each made the corresponding test fail; restored, they pass.
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

## Fixed during verification

- The order-conversation escalation the screens described did not exist; it was built (`escalateUnanswered`, job `support-escalation`) with integration tests.
- Two older checkout tests asserted on the quote immediately after the page heading appeared. Extra optional requests on checkout made that a race (about one full run in four); they now wait for the quote.
- `AI_PROVIDER=anthropic` was accepted by config but did nothing; config now accepts only `none`.

## Not verified here, and why

| What | Why |
|---|---|
| A browser end-to-end run of the full flow (C-23) | needs a Supabase project; there is no `backend/.env` and no credentials |
| A live payment gateway | only the mock provider exists |
| Real SMS / WhatsApp / email delivery | no vendor; attempts are recorded as `skipped` |
| AI photo recognition, photo/PDF invoices | no AI provider; adding the SDK would rewrite `backend/package-lock.json` |
| Phone layouts on real devices (checked in desktop Chromium's mobile emulation only) | no device here |
| Camera barcode scanning on a real device | tested with a mocked `BarcodeDetector` and camera; needs a phone browser to see it work |
| Speech input on a real device | tested with a mocked `SpeechRecognition` |
