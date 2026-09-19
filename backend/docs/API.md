# CPSE Customer API — v1

Base path: **`/api/v1`**. Every path below is relative to it.

This is the contract the frontend is built against. It is kept honest by
`tests/routeAudit.test.js`, which walks the mounted router tree and checks that
every route here requires the authentication this document claims, validates its
identifiers, and answers with the envelope described below.

- [Conventions](#conventions)
- [Authentication](#authentication)
- [Errors](#errors)
- [Endpoints](#endpoints)
  - [Health](#health)
  - [Auth](#auth)
  - [Profile](#profile)
  - [Storefront](#storefront-public)
  - [Saved stores](#saved-stores)
  - [Cart](#cart)
  - [Addresses](#addresses)
  - [Checkout](#checkout)
  - [Orders](#orders)
  - [Payments](#payments)
  - [Notifications](#notifications)
  - [Khata](#khata)
- [Rate limits](#rate-limits)
- [Invariants worth knowing](#invariants-worth-knowing)

---

## Conventions

**Money is always an integer number of paise**, in a field ending `Paise`. Never a
float, never a formatted string. ₹199.00 is `19900`.

**Success**

```json
{ "success": true, "data": { }, "meta": { } }
```

`data` is always an object with a named key (`store`, `cart`, `order`, `orders`),
never a bare array — so a response can grow a sibling field without breaking a
client. `meta` carries pagination when the endpoint is a list.

**Failure**

```json
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Order was not found.", "details": {} },
  "requestId": "0f1e2d3c-..."
}
```

**Pagination.** List endpoints take `?page=` (1-based) and `?limit=`, and answer with

```json
"meta": { "page": 1, "limit": 20, "total": 57, "totalPages": 3, "hasNextPage": true }
```

`limit` is capped at 100. Asking for more is a 422, not a silent clamp.

**Casing.** Requests and responses are camelCase. The database is snake_case and
never leaks — asserted by `tests/ownership.test.js`.

**Unknown fields are rejected.** Every request schema is strict: an unrecognised
body field, or an unrecognised query parameter, is a **422** listing the offending
field. Sending `email` to `PATCH /me` tells you the field is immutable instead of
pretending the edit worked. Endpoints that take no body reject a non-empty one.

**`X-Request-Id`** is echoed on every response and appears in every log line for
that request. Send your own to trace a call end to end; anything that is not 8–64
characters of `[A-Za-z0-9._:-]` is replaced with a generated one.

---

## Authentication

Supabase Auth is the identity provider. The API returns Supabase's own tokens
rather than minting a session of its own, so the frontend stores the access and
refresh pair and sends:

```
Authorization: Bearer <accessToken>
```

A missing, malformed or expired token is **401** with code `UNAUTHORIZED`. It is
never a 403, and never a 500.

Endpoints marked **public** work with no token at all — a shared store link must
open in a browser that has never signed in. Public store endpoints accept an
optional token and personalise when one is present: `isSaved` is `null` when
anonymous and a boolean when signed in.

---

## Errors

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | A request that is well-formed but cannot be acted on |
| 400 | `MALFORMED_JSON` | The body is not valid JSON |
| 401 | `UNAUTHORIZED` | No token, a junk token, or an expired one |
| 403 | `FORBIDDEN` | Disallowed CORS origin. Never used for ownership |
| 404 | `NOT_FOUND` | The resource does not exist **or belongs to someone else** |
| 404 | `ROUTE_NOT_FOUND` | No such endpoint |
| 409 | `CONFLICT` | An illegal state change — cancelling a delivered order, settling a settled payment |
| 413 | `PAYLOAD_TOO_LARGE` | Body over the configured cap (32kb by default) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Unsupported charset or content encoding |
| 422 | `VALIDATION_FAILED` | Schema failure. `details.issues[]` is `{ source, field, message }` |
| 429 | `RATE_LIMITED` | Over a rate limit |
| 500 | `INTERNAL_ERROR` | Our fault. Never carries internals |
| 503 | `SERVICE_UNAVAILABLE` | An upstream (Supabase, the payment provider) is down |

Domain-specific 422 codes, each meaning "your request was understood and
refused for a reason the customer can act on":

| Code | Meaning |
|---|---|
| `CART_EMPTY` | Nothing to check out |
| `MINIMUM_ORDER_NOT_MET` | Below the store's floor. `details.shortfallPaise` says by how much |
| `ITEM_UNAVAILABLE` | An item sold out between the quote and the commit |
| `PRICE_CHANGED` | A line's price moved since the client last saw it |
| `TOTAL_CHANGED` | `expectedTotalPaise` no longer matches. Nobody is charged a number they did not see |
| `ADDRESS_REQUIRED` | Delivery was asked for without an address |
| `FULFILMENT_UNAVAILABLE` | The store does not offer that mode |
| `STORE_CLOSED` | Surfaced as a *warning* on a quote, not a blocker |
| `NOT_AN_ONLINE_ORDER` | Payment endpoints called on a cash order |
| `PAYMENT_FAILED` | The provider declined |

**The ownership rule.** A resource that exists but belongs to another customer
returns **404**, never 403 — a 403 would confirm it exists. This holds for
addresses, cart items, orders, payments, notifications and khata accounts.

---

## Endpoints

### Health

| | |
|---|---|
| `GET /health` | **public.** Liveness. Does not touch the database. |

### Auth

| | |
|---|---|
| `POST /auth/register` | **public.** `{ email, password, fullName, phone? }` → **201** `{ customer, session, emailConfirmationRequired }`. `session` is `null` when email confirmation is on. A duplicate email is **409**. |
| `POST /auth/login` | **public.** `{ email, password }` → `{ customer, session }`. **401** on bad credentials, with the same message for an unknown email as for a wrong password. |
| `POST /auth/refresh` | **public.** `{ refreshToken }` → a rotated `{ session }`. |
| `POST /auth/logout` | Bearer. No body. **204**. Revokes refresh tokens globally. |
| `POST /auth/forgot-password` | **public.** `{ email }` → always **200**, whether or not the address is registered. |
| `POST /auth/reset-password` | **public.** `{ accessToken, password }` — the token comes from the emailed link. |

Login, forgot-password and reset all answer identically whether or not the
account exists, so the forms cannot be used to enumerate accounts.

### Profile

| | |
|---|---|
| `GET /me` | Bearer. `{ customer }`. |
| `PATCH /me` | Bearer. `{ fullName?, phone?, avatarUrl? }`. Sending `email` or `id` is a **422**, not a silent no-op. |

### Storefront (public)

All five accept an optional bearer token and personalise when one is present.

| | |
|---|---|
| `GET /stores/:slug` | **public.** The store page: contact, location, `hours` (with `isOpen` and `opensAt`, computed in the store's own timezone), `fulfilment`, `minOrderPaise`, `isSaved`. |
| `GET /stores/:slug/categories` | **public.** Active categories, in sort order. |
| `GET /stores/:slug/products` | **public.** `?categoryId=&page=&limit=&availableOnly=`. Sold-out and withdrawn products are **listed**, with `isPurchasable: false`. `stock: null` means untracked. |
| `GET /stores/:slug/products/:productId` | **public.** Full detail: images and variants. A product id from another store is **404**. |
| `GET /stores/:slug/search` | **public.** `?q=&categoryId=&page=&limit=`. Store-scoped, name and description, minimum 2 characters. |

An unknown slug, an inactive store, and a `categoryId` belonging to another
store all return **404** — never an empty list, which would confirm the id is
real somewhere.

### Saved stores

| | |
|---|---|
| `POST /stores/:storeId/save` | Bearer, no body. Idempotent — saving twice is still 200 and still one row. |
| `DELETE /stores/:storeId/save` | Bearer, no body. Idempotent — unsaving something never saved succeeds. |
| `GET /saved-stores` | Bearer. `?page=&limit=`. `{ savedStores: [{ savedAt, store }] }`, newest save first. Each entry carries the slug, name, logo and open/closed state, so the screen can link straight to the store. A store that has since been deactivated is dropped from the list; the save is kept, so it returns if the store does. |

The store is addressed by **uuid** here, not slug: the public storefront is
slug-keyed because that is what a shared link carries, while every authenticated
write (cart, checkout, orders, save) takes a `storeId`.

### Cart

The cart is **store-scoped** — one active cart per customer per store — so
`storeId` is required.

| | |
|---|---|
| `GET /cart?storeId=` | `{ cart }`: `lines`, `totals`, per-line `issues`, `isCheckoutReady`. |
| `POST /cart/items` | `{ storeId, productId, variantId?, quantity? }` → **201** with the updated cart. Same product with a different variant is a separate line; the same line again bumps the quantity. |
| `PATCH /cart/items/:itemId` | `{ quantity }`. Capped by stock and by 999. `quantity: 0` is a **422** — use DELETE. |
| `DELETE /cart/items/:itemId` | Removes one line. |
| `DELETE /cart?storeId=` | Empties the cart, keeps the cart row. |
| `POST /cart/validate` | `{ storeId, items?: [{ itemId, unitPricePaise }] }` → per-item availability and price-drift issues. Pass what the client last displayed to have drift reported against it. |

**The cart stores no prices.** Every read reprices from the catalogue, so a
merchant's change is visible immediately rather than at the till.

### Addresses

| | |
|---|---|
| `GET /addresses` | Default first, then newest. |
| `POST /addresses` | `{ recipientName, phone, line1, line2?, landmark?, city, state, postalCode, country?, label?, latitude?, longitude?, isDefault? }` → **201**. The first address saved becomes the default. |
| `GET /addresses/:id` | |
| `PATCH /addresses/:id` | Any subset of the above. |
| `DELETE /addresses/:id` | An address referenced by an order is not orphaned — the order keeps its own snapshot. |
| `POST /addresses/:id/default` | No body. Moves the default; at most one per customer. |

### Checkout

| | |
|---|---|
| `POST /checkout/quote` | `{ storeId, fulfilmentMode, addressId?, customerNote? }` → `{ quote }`. Changes nothing. |

The quote is the single gate every order passes through. It returns the full
priced breakdown plus:

- `blockers[]` — every reason the order cannot be placed, all at once, each with a code and a message the customer can act on;
- `warnings[]` — things they should know but that do not stop them, such as a closed store or a price that moved;
- `canPlaceOrder` — the boolean the checkout button binds to.

A closed store is a warning, not a blocker: there is no scheduled ordering, so
blocking would simply lose the order. It waits in `placed` until the store opens.

### Orders

| | |
|---|---|
| `POST /orders` | `{ storeId, fulfilmentMode, addressId?, paymentMethod, customerNote?, expectedTotalPaise? }` → **201** `{ order, replayed }`. **Send `Idempotency-Key`.** |
| `GET /orders` | `?status=&storeId=&page=&limit=`. Newest first. |
| `GET /orders/:id` | Items, totals, payment, fulfilment, and a `timeline` of `{ steps, history }`. |
| `POST /orders/:id/cancel` | `{ reason? }`. Only from `pending_payment`, `placed` or `accepted`; anything later is **409** — the goods may already be packed. |
| `GET /orders/:id/receipt` | Derived from the order's own snapshot, never recalculated. |
| `POST /orders/:id/reorder` | No body. Rebuilds the cart and reports what could not be added, per item. |
| `POST /orders/:id/test-advance` | ⚠️ **Test-only.** `{ status, note? }`. Stands in for the merchant dashboard. Mounted only when `ENABLE_TEST_ENDPOINTS=true`; the app refuses to boot in production with it on. Still goes through the state machine, so it cannot manufacture an illegal transition. |

**Idempotency.** Send an `Idempotency-Key` header. A replay returns the original
order with **200** (not 201) and `replayed: true` — no second charge, no second
stock decrement. Keys are scoped per customer.

**Status machine.**

```
pending_payment ─▶ placed ─▶ accepted ─▶ preparing ─┬▶ ready_for_pickup ─▶ completed
                                                    └▶ out_for_delivery ─▶ completed
```

`cancelled` and `rejected` are reachable from the early states. `completed`,
`cancelled` and `rejected` are terminal. An illegal transition is **409**.

The timeline is fulfilment-aware: a pickup order never shows
`out_for_delivery`, and a delivery order never shows `ready_for_pickup`.

**Snapshots.** Product name, price, variant, store contact and delivery address
are copied onto the order at creation. Order history stays truthful even after a
merchant edits a product or the customer deletes the address.

### Payments

| | |
|---|---|
| `GET /payments/methods` | **public.** What the platform can take — the checkout screen needs it before anything exists. |
| `POST /payments/:orderId/initiate` | Bearer, no body. → `{ payment, clientPayload }`. |
| `POST /payments/:orderId/verify` | Bearer. `{ providerRef? }`. The client's claim is a prompt to ask the provider, not an answer. |
| `POST /payments/webhook` | **public**, signature-authenticated. `X-CPSE-Signature: <hex>` = HMAC-SHA256 of the **raw request body** with `PAYMENT_WEBHOOK_SECRET`. Idempotent. |

**An order is never marked paid on a client's say-so.** A cash order is `placed`
immediately. An online order is created as `pending_payment` and becomes `placed`
only when the provider confirms — through the signed webhook or the verify
endpoint. A failed payment leaves the order where it is so the customer can
retry; a cancelled one cancels the order.

Webhook specifics: the signature is over the exact bytes sent, so a
re-serialised body will not verify. A replayed event is a 200 that changes
nothing. An unknown provider reference is also answered **200** — a 4xx would
make a real gateway retry forever.

### Notifications

In-app only, written by the API and polled by the client. There is no create
endpoint: a client cannot manufacture a notification.

| | |
|---|---|
| `GET /notifications` | `?unreadOnly=&page=&limit=` → `{ notifications, unreadCount }`, newest first. |
| `GET /notifications/unread-count` | `{ unreadCount }` — the badge, without fetching the rows. |
| `POST /notifications/:id/read` | No body. Idempotent: an already-read row keeps its original `readAt`. |
| `POST /notifications/read-all` | No body. `{ updated, unreadCount }`. |

Types: `order_placed`, `order_status_changed`, `order_cancelled`,
`payment_succeeded`, `payment_failed`, `khata_updated`. `payload` carries only
deep-link ids — `order_id`, `order_number`, `store_id`. No prices, no addresses,
no phone numbers: this is the most-polled screen in the app.

Emission is tied to the single writer of `orders.status`, so each change is
notified exactly once, whoever caused it. A notification that fails to write is
logged and dropped — it never fails the order that caused it.

### Khata

Store credit, **read-only for customers**. There are no write endpoints at all:
the router mounts only GET verbs, the service exports no writer, RLS grants the
customer `select` and nothing else, and ledger rows are immutable by trigger.
Merchant-side khata administration is out of scope.

| | |
|---|---|
| `GET /khata` | `{ accounts, totalOutstandingPaise }`. |
| `GET /khata/:accountId` | `?page=&limit=` → `{ account, totals, transactions }`. |
| `GET /khata/:accountId/statement` | `?from=&to=&page=&limit=` → `{ account, period, totals, transactions }`. Dates are ISO 8601 with an offset. `to` before `from` is a 422. |

`balancePaise` is signed: positive means the customer owes the store.
`outstandingPaise` and `creditPaise` are the two sides of it, already clamped, so
a client never has to reason about the sign. A statement's `openingPaise` is the
balance carried into the period and `closingPaise` the balance leaving it; with
no `from`, the period starts at the beginning of the ledger and opens at zero.

The account's `balancePaise` comes from the trigger-maintained column rather than
from re-adding the ledger. If those two ever disagreed, the number the store acts
on is the one to show.

---

## Rate limits

Four buckets, all returning **429** `RATE_LIMITED` with standard
`RateLimit-*` headers.

| Bucket | Default | Applies to |
|---|---|---|
| Global | `RATE_LIMIT_MAX` = 300 / 15 min | Everything under `/api/v1` |
| Auth | `AUTH_RATE_LIMIT_MAX` = 20 / 15 min | Every `/auth/*` route |
| Write | `WRITE_RATE_LIMIT_MAX` = 60 / 15 min | `POST /orders`, reorder, payment initiate and verify |
| Webhook | `WEBHOOK_RATE_LIMIT_MAX` = 120 / min | `POST /payments/webhook` |

The webhook limit is deliberately generous: a 429 to a real gateway makes it
retry the same event for hours, and the HMAC signature is the real gate there.

Request bodies are capped at `JSON_BODY_LIMIT` (32kb).

---

## Invariants worth knowing

These are the things a frontend can rely on without defensive code.

1. **The number shown is the number charged.** One pricing engine serves the cart, the quote and order creation. `create_order` is handed the totals and does not recompute them.
2. **Catalogue prices are tax-inclusive**, so `taxPaise` is always `0`. The field exists because the column does.
3. **Order creation is one transaction.** Order, items, first history entry, payment intent, stock decrement and cart checkout commit together or not at all. A request that dies halfway leaves the cart exactly as it was.
4. **404 means "not yours or not there".** Never probe for existence with status codes.
5. **Public store pages need no token**, and personalise with one.
6. **Ownership is enforced in application code**, with RLS on every table as defense in depth. The API uses the service-role key, which bypasses RLS by design.
7. **Nothing is soft-deleted silently.** A withdrawn product is still listed with `isPurchasable: false`, and an order is cancelled rather than removed.
