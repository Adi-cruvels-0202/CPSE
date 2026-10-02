# Merchant One — the shopkeeper app

The merchant side of CPSE, served by the backend at **`/merchant`**. It started as
Mohit's Merchant-One frontend (React + TypeScript), kept its design, and was
rewired from Merchant-One's Java API to CPSE's (`backend/docs/API.md`, the
*Merchant* sections).

## Running it

Normally you do not run it on its own: `npm run dev` in `backend/` serves it at
**http://localhost:4000/merchant**, beside the customer app at `/`. After
`npm run db:seed`, sign in as `demo.merchant@cpse.local` / `CpseMerchant!2026`.

On its own (the backend must still be running on 4000):

```bash
npm install
npm run dev        # http://localhost:5174/merchant/
npm test           # money, the shared session, the API client
npm run typecheck
npm run build      # into dist/, which the backend serves in production
```

## One login, two apps

A shopkeeper is a customer account with a merchant profile (MERGE_MAPPING D-2).
Both apps keep the session under the same localStorage key (`cpse.session`,
`src/lib/session.ts`), on the same origin — so signing in on either signs you in
on both, and signing out of either signs you out of both.

Signed in with an account that only shops so far? The app offers **Set up
selling** (`POST /merchant/onboard`) rather than an error.

## What is where

| | |
|---|---|
| `src/api/client.ts` | The one way to the backend: unwraps the envelope, attaches the token, refreshes it once on a 401 and replays, and turns failures into `ApiError` with the server's own message. |
| `src/api/endpoints.ts` | Every call, named — one place per path. |
| `src/api/types.ts` | The response shapes. Money is integer paise throughout. |
| `src/lib/money.ts` | Rupees only on screen; `taxFor` rounds exactly like the server, for the till's preview. |
| `src/hooks/useAuth.tsx` | Signed out / needs onboarding / merchant. |
| `src/hooks/useStore.tsx` | Which of your stores every screen is working on. |
| `src/features/` | Dashboard, store setup (details, hours, holidays, delivery, payments, logo & cover), categories, products (variants and photos), stock and its history, online orders, counter sales and their history. |

## Rules the screens lean on the server for

- **Order buttons** are the order's `allowedActions`, worked out by the server
  from its state and fulfilment mode — the screen never re-implements the rules.
- **Stock** is changed only through Stock (receive, take out, count) or a new
  variant's opening stock. "Held" units belong to open orders and cannot be
  taken out or sold at the counter.
- **Prices and tax** on a counter sale are recomputed by the server; the till's
  running total is a preview.
- **Photos** are checked by their bytes, not their name, and stored in Supabase
  Storage.

Purchases and batches (Merchant-One's P2 screens) are not part of this app yet.
