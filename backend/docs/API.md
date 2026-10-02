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
  - [Merchant account](#merchant-account)
  - [Merchant stores](#merchant-stores)
  - [Merchant catalogue](#merchant-catalogue)
  - [Merchant inventory](#merchant-inventory)
  - [Merchant orders](#merchant-orders)
  - [Merchant photos, holidays, sales and dashboard](#merchant-photos-holidays-sales-and-dashboard)
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
| 403 | `MERCHANT_REQUIRED` | Signed in, but not a merchant, on a `/merchant` route. A role check, not ownership — the merchant app offers onboarding |
| 404 | `NOT_FOUND` | The resource does not exist **or belongs to someone else** |
| 404 | `ROUTE_NOT_FOUND` | No such endpoint |
| 409 | `CONFLICT` | An illegal state change — cancelling a delivered order, settling a settled payment, publishing a published store |
| 409 | `SLUG_TAKEN` | A store link already used by another store. `details.slug` |
| 409 | `CATEGORY_NAME_TAKEN` | The store already has a category with that name, ignoring case. `details.name` |
| 409 | `SKU_TAKEN` | The store already uses that SKU, ignoring case. `details.sku` when known |
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
| `VARIANT_REQUIRED` | Added a product that has several options without saying which |
| `PAYMENT_METHOD_UNAVAILABLE` | The store does not take that payment method. `details.accepts` says what it does take |
| `NOT_TRACKED` | A stock movement on a product whose stock is not counted (`trackInventory: false`) |
| `BELOW_RESERVED` | A stock count lower than what open orders hold. `details.reservedQuantity` |
| `IMAGE_REQUIRED` | An upload with no photo in a multipart field named `file` |
| `IMAGE_INVALID` | The file is not really a JPEG, PNG or WebP — judged from its bytes, not its name |
| `IMAGE_LIMIT` | A product already has 10 photos |
| `DISCOUNT_TOO_LARGE` | A counter sale's discount is more than the bill. `details.maxDiscountPaise` |
| `STORE_INCOMPLETE` | A merchant tried to publish a store that is missing something customers need. `details.missing[]`: `address`, `phone`, `openingHours`, `fulfilment` |
| `OUT_OF_STOCK` / `INSUFFICIENT_STOCK` | Nothing, or not enough, is **available** — on hand minus what open orders hold. `details.available` says how many |
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
| `POST /auth/login` | **public.** `{ email, password }` → `{ customer, session, roles }`. `roles` is `["customer"]` or `["customer", "merchant"]`; the customer app can ignore it. **401** on bad credentials, with the same message for an unknown email as for a wrong password. |
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
| `GET /stores/:slug` | **public.** The store page: contact, location, `hours` (with `isOpen` and `opensAt`, computed in the store's own timezone), `fulfilment` (`minOrderPaise`, `deliveryFeePaise`, and `freeDeliveryThresholdPaise` — delivery is free once the subtotal reaches it; `null` = never), `isSaved`. |
| `GET /stores/:slug/categories` | **public.** Active categories, in sort order. |
| `GET /stores/:slug/products` | **public.** `?categoryId=&page=&limit=&availableOnly=`. Sold-out and withdrawn products are **listed**, with `isPurchasable: false`. `stock` is what can still be ordered across the product's variants — on hand minus what open orders hold — and `null` means not counted. `pricePaise` is the cheapest variant's. `taxPercent` is added on top at checkout: show "+ GST" when it is above 0. |
| `GET /stores/:slug/products/:productId` | **public.** Full detail: images and `variants` (each with its own `pricePaise`, `mrpPaise` and available `stock`). A product sold without options returns `variants: []` — it has one hidden Default variant, which the cart fills in. Once a merchant adds options to such a product, its Default is listed with them so it can still be chosen. A product id from another store is **404**. |
| `GET /stores/:slug/search` | **public.** `?q=&categoryId=&page=&limit=`. Store-scoped, name and description, minimum 2 characters. |

An unknown slug, an inactive store, a store its merchant has not published (or
has unpublished), and a `categoryId` belonging to another store all return
**404** — never an empty list, which would confirm the id is real somewhere. The
same holds for the cart, checkout and saved stores.

The store page's `payment: { online, cashOnDelivery }` is what the merchant has
switched on; `POST /orders` with a method the store does not take is **422
`PAYMENT_METHOD_UNAVAILABLE`**.

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
| `POST /cart/items` | `{ storeId, productId, variantId?, quantity? }` → **201** with the updated cart. `variantId` may be left out when the product has only one variant; with several it is **422 `VARIANT_REQUIRED`**. Same product with a different variant is a separate line; the same line again bumps the quantity. |
| `PATCH /cart/items/:itemId` | `{ quantity }`. Capped by stock and by 999. `quantity: 0` is a **422** — use DELETE. |
| `DELETE /cart/items/:itemId` | Removes one line. |
| `DELETE /cart?storeId=` | Empties the cart, keeps the cart row. |
| `POST /cart/validate` | `{ storeId, items?: [{ itemId, unitPricePaise }] }` → per-item availability and price-drift issues. Pass what the client last displayed to have drift reported against it. |

**The cart stores no prices.** Every read reprices from the catalogue, so a
merchant's change is visible immediately rather than at the till.

**A line** carries `unitPricePaise`, `quantity`, `lineSubtotalPaise` (price ×
quantity), `taxPercent`, `taxPaise` and `lineTotalPaise` — **tax included**. The
same shape is used on order lines and receipts. `variantName` is `null` for a
product sold without options.

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

**Idempotency.** Send an `Idempotency-Key` header. A replay returns the original
order with **200** (not 201) and `replayed: true` — no second charge, no second
stock reservation. Keys are scoped per customer.

**Stock.** Placing an order **reserves** its items: they stop being available to
anyone else, but stay on the shelf. Cancelling (by the customer or the store),
rejecting, or an unpaid order expiring gives them back; completing the order
takes them off the shelf. So two customers can never both buy the last unit, and
a cancelled order always returns its stock.

**Status machine.**

```
pending_payment ─▶ placed ─▶ accepted ─▶ preparing ─┬▶ ready_for_pickup ─▶ completed
                                                    └▶ out_for_delivery ─▶ completed
```

`cancelled` and `rejected` are reachable from the early states. `completed`,
`cancelled` and `rejected` are terminal. An illegal transition is **409**.

The timeline is fulfilment-aware: a pickup order never shows
`out_for_delivery`, and a delivery order never shows `ready_for_pickup`.

**Snapshots.** Product name, price, variant, SKU, tax rate and tax, store
contact and delivery address are copied onto the order at creation. Order history stays truthful even after a
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


### Merchant account

The shopkeeper side shares this login (one Supabase Auth, MERGE_MAPPING D-2): a
merchant is an account with a merchant profile, and is still a customer too.
Sign-in, refresh, logout and password reset are the `/auth` endpoints above.

| | |
|---|---|
| `POST /merchant/auth/register` | **public.** `{ email, password, fullName, phone? }` → **201** `{ merchant, session, emailConfirmationRequired }`. Same rules and wording as `/auth/register`: a taken email is **409**; with email confirmation on, `merchant` and `session` are `null`. |
| `POST /merchant/onboard` | Bearer. `{ fullName?, phone? }` → **201** `{ merchant }`: an existing account becomes a merchant, taking any field left out from its customer profile. Already a merchant → **200**, same shape. |
| `GET /merchant/me` | Bearer, merchant. `{ merchant, stores: [{ id, name, slug, isPublished, logoUrl }] }`, stores newest first. **403 `MERCHANT_REQUIRED`** means "offer onboarding". |
| `PATCH /merchant/me` | Bearer, merchant. `{ fullName?, phone? }` (`phone: null` clears it) → `{ merchant }`. `email` or `id` is a **422**. |

```json
"merchant": { "id": "7c1e…", "email": "owner@shop.in", "fullName": "Ravi Sharma", "phone": "+919876543210", "createdAt": "2026-10-01T09:00:00Z" }
```

**Guards on every `/merchant` route, in order:** no or bad token → **401**; a
malformed id in the path → **422**; not a merchant → **403 `MERCHANT_REQUIRED`**;
a `storeId` that is not yours, or does not exist → **404** (never 403, so a store
id cannot confirm that someone else's store exists); a malformed body → **422**.


### Merchant stores

Every route here is **Bearer, merchant**, and every `:storeId` is the caller's
own store — anyone else's, or one that does not exist, is the same **404**.

| | |
|---|---|
| `GET /merchant/stores` | Bearer, merchant. `{ stores }`, newest first, in every state. |
| `POST /merchant/stores` | Bearer, merchant. `{ name, slug?, description?, shopCategory?, phone?, email?, address?, latitude?, longitude?, timezone? }` → **201** `{ store }`. Created **unpublished**, pickup on, delivery off, cash only, no hours. No `slug` → one made from the name (`sharma-kirana`, then `sharma-kirana-2`, …); a `slug` already used is **409 `SLUG_TAKEN`**. |
| `GET /merchant/stores/:storeId` | Bearer, merchant. `{ store }` |
| `PATCH /merchant/stores/:storeId` | Bearer, merchant. Any subset of the create fields → `{ store }`. `address: null` clears it. `slug` can change only while unpublished — once published it is in shared links and QR codes, so a change is **409**. |
| `POST /merchant/stores/:storeId/publish` | Bearer, merchant. No body → `{ store }`. Missing details are **422 `STORE_INCOMPLETE`**, listed in `details.missing`; already published is **409**. |
| `POST /merchant/stores/:storeId/unpublish` | Bearer, merchant. No body → `{ store }`. Customers get **404** on it again; orders already placed carry on. Not published is **409**. |
| `PUT /merchant/stores/:storeId/hours` | Bearer, merchant. `{ timezone?, openingHours }` → `{ store }`. Replaces the whole week. |
| `PUT /merchant/stores/:storeId/delivery` | Bearer, merchant. `{ pickupEnabled, deliveryEnabled, deliveryFeePaise, minOrderPaise, freeDeliveryThresholdPaise?, deliveryRadiusKm? }` → `{ store }`. At least one of pickup and delivery (**422**). |
| `PUT /merchant/stores/:storeId/payments` | Bearer, merchant. `{ cash, online }`, at least one true → `{ store }`. |

**`openingHours`** — all seven keys (`mon` … `sun`), each a list of up to three
`{ open, close }` windows in 24-hour `HH:MM`. `[]` is a closed day. A window
whose `close` is earlier than its `open` runs past midnight. `timezone` is an
IANA zone (default `Asia/Kolkata`); an unknown one is **422**. This is the same
format the customer store page computes open/closed from.

**`store`** (the merchant's view — includes what customers never see):

```json
"store": {
  "id": "3f2a…", "slug": "sharma-kirana", "name": "Sharma Kirana",
  "description": "Groceries and daily needs", "shopCategory": "grocery",
  "phone": "+919876543210", "email": "sharma@shop.in",
  "address": { "line1": "12 MG Road", "line2": null, "city": "Pune", "state": "MH", "postalCode": "411001", "country": "IN" },
  "latitude": 18.5204, "longitude": 73.8567, "logoUrl": null, "coverImageUrl": null,
  "timezone": "Asia/Kolkata", "openingHours": { "mon": [{ "open": "09:00", "close": "21:30" }], "…": [] },
  "hours": { "isOpen": false, "opensAt": "09:00" },
  "fulfilment": { "pickupEnabled": true, "deliveryEnabled": true, "deliveryFeePaise": 3000, "minOrderPaise": 19900, "freeDeliveryThresholdPaise": 99900, "deliveryRadiusKm": 5 },
  "paymentMethods": { "cash": true, "online": true },
  "isPublished": true, "publicPath": "/store/sharma-kirana",
  "createdAt": "…", "updatedAt": "…"
}
```

`shopCategory`: `grocery`, `pharmacy`, `restaurant`, `bakery`, `electronics`,
`clothing`, `general`, `other`. `publicPath` is what a "share" or QR-code button
links to.


### Merchant catalogue

Bearer, merchant, on the caller's own store. A category, product or variant id
from another store is the same **404** as one that does not exist.

**Categories** — there is no delete; deactivating hides a category from
customers and leaves its products listed under "all".

| | |
|---|---|
| `GET /merchant/stores/:storeId/categories` | Bearer, merchant. `{ categories }` — inactive ones too, in sort order, each with `productCount`. |
| `POST /merchant/stores/:storeId/categories` | Bearer, merchant. `{ name, description? }` → **201** `{ category }`. Name 1–100 characters, unique in the store ignoring case (**409 `CATEGORY_NAME_TAKEN`**). Added at the end of the order. |
| `PATCH /merchant/stores/:storeId/categories/:categoryId` | Bearer, merchant. `{ name?, description? }` → `{ category }`. |
| `POST /merchant/stores/:storeId/categories/:categoryId/activate` | Bearer, merchant. No body → `{ category }`. |
| `POST /merchant/stores/:storeId/categories/:categoryId/deactivate` | Bearer, merchant. No body → `{ category }`. |

```json
"category": { "id": "c1…", "name": "Rice & Grains", "slug": "rice-grains", "description": null, "isActive": true, "sortOrder": 2, "productCount": 14, "createdAt": "…", "updatedAt": "…" }
```

**Products and variants.** Every product has at least one variant; price, MRP,
cost, SKU and stock live on the variant. Stock is **never set here** except as a
new variant's `openingQuantity`, which is logged as a `stock_in` — every other
change goes through inventory. There is no delete: order lines keep the product
for reorder. Deactivate instead.

| | |
|---|---|
| `GET /merchant/stores/:storeId/products` | Bearer, merchant. `?search=&categoryId=&isActive=&lowStock=&page=&limit=` → `{ products }` with pagination `meta`. Inactive products included unless `isActive=true`. `lowStock=true`: some active variant can sell no more than the product's `lowStockThreshold`. |
| `POST /merchant/stores/:storeId/products` | Bearer, merchant. The body below → **201** `{ product }`. One transaction: product, variants, opening stock and images, or nothing. |
| `GET /merchant/stores/:storeId/products/:productId` | Bearer, merchant. `{ product }` |
| `PATCH /merchant/stores/:storeId/products/:productId` | Bearer, merchant. `{ name?, description?, categoryId?, unit?, taxPercent?, trackInventory?, lowStockThreshold?, images? }` → `{ product }`. `categoryId: null` uncategorises; `images` replaces the list. |
| `POST /merchant/stores/:storeId/products/:productId/activate` | Bearer, merchant. No body → `{ product }`. |
| `POST /merchant/stores/:storeId/products/:productId/deactivate` | Bearer, merchant. No body → `{ product }`. Customers still see it, unavailable. |
| `POST /merchant/stores/:storeId/products/:productId/variants` | Bearer, merchant. One variant (below) → **201** `{ product }`. |
| `PATCH /merchant/stores/:storeId/products/:productId/variants/:variantId` | Bearer, merchant. `{ name?, sku?, barcode?, weightGrams?, pricePaise?, mrpPaise?, costPaise? }` → `{ product }`. No stock here. |
| `POST /merchant/stores/:storeId/products/:productId/variants/:variantId/activate` | Bearer, merchant. No body → `{ product }`. |
| `POST /merchant/stores/:storeId/products/:productId/variants/:variantId/deactivate` | Bearer, merchant. No body → `{ product }`. |

```json
{
  "name": "India Gate Basmati Rice", "description": "Aged basmati", "categoryId": "c1…",
  "unit": "kg", "taxPercent": 5, "trackInventory": true, "lowStockThreshold": 5,
  "images": [{ "url": "https://…/rice.jpg", "altText": "Rice bag" }],
  "variants": [
    { "name": "1 kg", "sku": "RICE-1KG", "pricePaise": 12900, "mrpPaise": 14500, "costPaise": 10500, "openingQuantity": 40 },
    { "name": "5 kg", "pricePaise": 59900, "openingQuantity": 10 }
  ]
}
```

- `variants`: 1–50, names different within the product (ignoring case). `sku`
  optional — generated as `SKU-<name letters>-<6 random>` if left out — and
  unique in the store, ignoring case (**409 `SKU_TAKEN`**). `mrpPaise` is never
  below `pricePaise` (**422**). `openingQuantity` needs `trackInventory: true`.
- `unit`: `pcs`, `kg`, `g`, `l`, `ml`, `m`, `cm`, `dozen`, `pack`, `box`, `pair`,
  `set`, `roll`, `plate`, `serving`; default `pcs`. `taxPercent`: 0–100, two
  decimals at most, default 0 — added on top at checkout. At most 10 images,
  http(s) URLs.
- A simple product is one variant; call it `Default` and customers never see a
  picker for it.

```json
"product": {
  "id": "p1…", "slug": "india-gate-basmati-rice", "name": "India Gate Basmati Rice", "description": "Aged basmati",
  "categoryId": "c1…", "categoryName": "Rice & Grains", "unit": "kg", "taxPercent": 5,
  "trackInventory": true, "lowStockThreshold": 5, "isActive": true, "pricePaise": 12900,
  "images": [{ "id": "i1…", "url": "https://…/rice.jpg", "altText": "Rice bag", "sortOrder": 0 }],
  "variants": [{
    "id": "v1…", "name": "1 kg", "sku": "RICE-1KG", "barcode": null, "weightGrams": null,
    "pricePaise": 12900, "mrpPaise": 14500, "costPaise": 10500, "isActive": true, "sortOrder": 0,
    "quantityOnHand": 40, "reservedQuantity": 3, "availableQuantity": 37, "isLowStock": false
  }],
  "stock": { "quantityOnHand": 50, "reservedQuantity": 3, "availableQuantity": 47 },
  "isLowStock": false, "createdAt": "…", "updatedAt": "…"
}
```

`pricePaise` is the cheapest active variant's — what the customer's product card
shows. Stock fields are `null` when `trackInventory` is false. `costPaise` is the
merchant's alone: no customer response carries it, and the public database roles
cannot read the column.


### Merchant inventory

Bearer, merchant, on the caller's own store. Stock is per variant: **on hand**
is on the shelf, **reserved** is held by open orders, and **available = on hand −
reserved** is what can still be sold. Every change is a ledger row and the
ledger is append-only — a mistake is corrected by a new movement, never an edit.
A variant from another store is **404**; one whose product has
`trackInventory: false` is **422 `NOT_TRACKED`**.

| | |
|---|---|
| `POST /merchant/stores/:storeId/inventory/stock-in` | Bearer, merchant. `{ variantId, quantity, unitCostPaise?, notes? }` → `{ variant, entry }`. `quantity` 1–100000. |
| `POST /merchant/stores/:storeId/inventory/stock-out` | Bearer, merchant. `{ variantId, quantity, reason, notes? }` → `{ variant, entry }`. `reason`: `damaged`, `expired`, `lost`, `returned_to_supplier`, `own_use`, `other`. More than **available** is **422 `INSUFFICIENT_STOCK`** with `details.availableQuantity` — reserved units cannot be taken out. |
| `POST /merchant/stores/:storeId/inventory/adjust` | Bearer, merchant. `{ variantId, newQuantity, reason }` → `{ variant, entry }`. Sets on hand after a physical count; `reason` is required. Below what open orders hold is **422 `BELOW_RESERVED`** with `details.reservedQuantity`; the same number as now is **422**. |
| `GET /merchant/stores/:storeId/inventory/history` | Bearer, merchant. `?variantId=&productId=&movementType=&from=&to=&page=&limit=` → `{ entries }` with pagination `meta`, newest first. `from`/`to` are ISO date-times. Includes the movements orders make. |

There is no separate stock list: `GET …/products` already carries every
variant's on hand, reserved and available.

```json
"variant": { "id": "v1…", "productId": "p1…", "productName": "India Gate Basmati Rice", "name": "1 kg", "sku": "RICE-1KG",
             "quantityOnHand": 40, "reservedQuantity": 3, "availableQuantity": 37, "isLowStock": false },
"entry": {
  "id": "l1…", "movementType": "order_reserved",
  "productId": "p1…", "productName": "India Gate Basmati Rice", "variantId": "v1…", "variantName": "1 kg", "sku": "RICE-1KG",
  "onHandChange": 0, "reservedChange": 2, "onHandAfter": 40, "reservedAfter": 3, "availableAfter": 37,
  "unitCostPaise": null, "reason": null, "notes": null,
  "reference": { "type": "order", "id": "o1…", "number": "CPSE-261002-65U5NC" },
  "performedBy": { "type": "customer", "id": "u1…" },
  "createdAt": "…"
}
```

`movementType`: `stock_in`, `stock_out`, `adjustment`, `order_reserved`,
`order_released`, `order_fulfilled` (later `sale`, `purchase`). `reference` is
`null` for the merchant's own movements. `performedBy.type` is `merchant`,
`customer` or `system`; releases and completions are `system`, and the order's
own history says who changed its status.


### Merchant orders

Bearer, merchant, on the caller's own store. An order of another store is
**404**, whichever store path it is asked through. The states are the ones in
*Orders* above, and every action goes through the same single writer as the
customer's cancel — so **the customer is notified of every merchant action**,
and stock is released or taken off the shelf with it (see *Stock*).

| | |
|---|---|
| `GET /merchant/stores/:storeId/orders` | Bearer, merchant. `?status=&fulfilmentMode=&from=&to=&page=&limit=` → `{ orders, counts }` with pagination `meta`, newest first. `status` takes a comma list (`placed,accepted`). Orders still waiting for online payment are left out unless asked for by name. `counts` is per status, for tab badges. |
| `GET /merchant/stores/:storeId/orders/:orderId` | Bearer, merchant. `{ order }` |
| `POST /merchant/stores/:storeId/orders/:orderId/accept` | Bearer, merchant. No body. `placed → accepted`. |
| `POST /merchant/stores/:storeId/orders/:orderId/reject` | Bearer, merchant. `{ reason? }` (≤ 300). `placed` or `accepted → rejected`; the stock comes back and the customer sees the reason. |
| `POST /merchant/stores/:storeId/orders/:orderId/status` | Bearer, merchant. `{ status }`: `preparing` (from accepted), then `ready_for_pickup` for a pickup order or `out_for_delivery` for a delivery order — never the other one. |
| `POST /merchant/stores/:storeId/orders/:orderId/complete` | Bearer, merchant. No body. `ready_for_pickup` or `out_for_delivery → completed`; the stock leaves the shelf. |
| `POST /merchant/stores/:storeId/orders/:orderId/cancel` | Bearer, merchant. `{ reason }`, 3–300 characters. From `accepted` onwards — a `placed` order is rejected instead. The stock comes back. |

All actions answer `{ order }`. Anything not in the order's `allowedActions` is
**409 `CONFLICT`** with `details: { status, action }`. An order in
`pending_payment` has no actions — only a confirmed payment moves it.

**Show the buttons `allowedActions` lists**; the server works them out from the
state and the fulfilment mode, so the screen never re-implements the rules.
Values: `accept`, `reject`, `cancel`, `complete`, `status:preparing`,
`status:ready_for_pickup`, `status:out_for_delivery`.

```json
"order": {
  "id": "o1…", "orderNumber": "CPSE-261002-65U5NC",
  "status": "accepted", "statusLabel": "Accepted by the store", "paymentStatus": "pending", "paymentMethod": "cash",
  "fulfilmentMode": "delivery",
  "allowedActions": ["status:preparing", "reject", "cancel"],
  "customer": { "id": "u1…", "name": "Jane Doe", "phone": "+919812345678" },
  "customerNote": "Ring the bell twice", "cancellationReason": null,
  "totals": { "subtotalPaise": 25800, "discountPaise": 0, "deliveryFeePaise": 3000, "taxPaise": 1290, "totalPaise": 30090 },
  "itemCount": 1,
  "deliveryAddress": { "recipientName": "Jane Doe", "phone": "+919812345678", "line1": "…", "city": "Pune", "postalCode": "411001" },
  "items": [{
    "id": "oi1…", "productId": "p1…", "variantId": "v1…", "productName": "India Gate Basmati Rice", "variantName": "1 kg", "sku": "RICE-1KG",
    "quantity": 2, "unitPricePaise": 12900, "lineSubtotalPaise": 25800, "taxPercent": 5, "taxPaise": 1290, "lineTotalPaise": 27090
  }],
  "history": [
    { "status": "placed", "changedBy": "customer", "note": null, "at": "…" },
    { "status": "accepted", "changedBy": "store", "note": null, "at": "…" }
  ],
  "placedAt": "…", "acceptedAt": "…", "completedAt": null, "cancelledAt": null, "updatedAt": "…"
}
```

List rows are the same object without `deliveryAddress`, `items` and `history`.


### Merchant photos, holidays, sales and dashboard

Bearer, merchant, on the caller's own store.

**Photos** are uploaded as `multipart/form-data` with one field named `file`:
JPEG, PNG or WebP, at most 5 MB (**413** above). The type is read from the
file's own bytes, so a renamed file is **422 `IMAGE_INVALID`**. Photos are
stored in Supabase Storage under a fresh random name and served from a public
URL; a replaced or removed photo the app stored is deleted.

| | |
|---|---|
| `POST /merchant/stores/:storeId/logo` | Bearer, merchant. Multipart `file` → `{ store }` with the new `logoUrl`. |
| `POST /merchant/stores/:storeId/cover` | Bearer, merchant. Multipart `file` → `{ store }` with the new `coverImageUrl`. |
| `POST /merchant/stores/:storeId/products/:productId/images` | Bearer, merchant. Multipart `file` → **201** `{ product }`, the photo added last. At most 10 (**422 `IMAGE_LIMIT`**). The first photo is what customers see on the product card. |
| `DELETE /merchant/stores/:storeId/products/:productId/images/:imageId` | Bearer, merchant. → `{ product }`. A photo of another product is **404**. |

**Holidays** close the store for the whole day, in its own timezone, whatever
its weekly hours say. The customer store page shows it closed, and `opensAt` /
`opensOnDate` skip to the next working day.

| | |
|---|---|
| `GET /merchant/stores/:storeId/holidays` | Bearer, merchant. `{ holidays: [{ id, date, reason }] }` — today's and later, in date order. |
| `POST /merchant/stores/:storeId/holidays` | Bearer, merchant. `{ date: "YYYY-MM-DD", reason? }` → **201** `{ holiday }`. Today or later; a date already listed is **409**. |
| `DELETE /merchant/stores/:storeId/holidays/:holidayId` | Bearer, merchant. **204**. |

**Counter (POS) sales** — a walk-in customer paying at the till. Priced by the
same engine as an order (tax per line, on top), and it sells only what is
**available**, so it never takes stock an online order holds. The stock leaves
the shelf at once and the movement is in the stock history as `sale`.

| | |
|---|---|
| `POST /merchant/stores/:storeId/sales` | Bearer, merchant. **Send `Idempotency-Key`.** `{ items: [{ variantId, quantity }], paymentMethod: cash\|upi\|card\|other, customerName?, customerPhone?, discountPaise?, notes? }` → **201** `{ sale, replayed: false }`; a replayed key is **200** with the first sale. Each variant once. Not enough available is **422 `INSUFFICIENT_STOCK`** with `details: { productName, availableQuantity }`; a discount above the bill is **422 `DISCOUNT_TOO_LARGE`**. |
| `GET /merchant/stores/:storeId/sales` | Bearer, merchant. `?from=&to=&page=&limit=` → `{ sales }` with pagination `meta`, newest first, without `items`. |
| `GET /merchant/stores/:storeId/sales/:saleId` | Bearer, merchant. `{ sale }` |

```json
"sale": {
  "id": "s1…", "invoiceNumber": "INV-000001", "paymentMethod": "upi",
  "customerName": "Walk-in", "customerPhone": null, "notes": null,
  "totals": { "subtotalPaise": 20000, "discountPaise": 0, "taxPaise": 1000, "totalPaise": 21000 },
  "itemCount": 1,
  "items": [{ "productName": "Basmati Rice", "variantName": null, "sku": "RICE-1", "quantity": 2, "unitPricePaise": 10000, "lineSubtotalPaise": 20000, "taxPercent": 5, "taxPaise": 1000, "lineTotalPaise": 21000 }],
  "createdAt": "…"
}
```

Invoice numbers count up per store: `INV-000001`, `INV-000002`, …

**Dashboard**

| | |
|---|---|
| `GET /merchant/stores/:storeId/dashboard` | Bearer, merchant. `{ dashboard }` below. |

```json
"dashboard": {
  "date": "2026-10-02",
  "today": { "ordersCount": 4, "ordersRevenuePaise": 120500, "salesCount": 6, "salesRevenuePaise": 84000 },
  "openOrders": { "placed": 2, "accepted": 1, "preparing": 0, "ready": 1 },
  "lowStock": [{ "productId": "p1…", "productName": "Basmati Rice", "variantId": "v1…", "variantName": "1 kg", "sku": "RICE-1", "availableQuantity": 3, "lowStockThreshold": 5 }],
  "recentOrders": [{ "id": "o1…", "orderNumber": "CPSE-…", "status": "placed", "statusLabel": "Order placed", "fulfilmentMode": "pickup", "totalPaise": 30090, "placedAt": "…" }]
}
```

"Today" is the store's own local day. Orders count when placed today and not
cancelled, rejected or still unpaid. `ready` covers ready for pickup and out for
delivery. Low stock lists variants of counted, active products that can sell no
more than their product's threshold, fewest first.

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
2. **Tax is added on top of the price.** Each line is taxed at its product's `taxPercent`, rounded half up to the paisa; the order's `taxPaise` is the sum of the lines'. The delivery fee is never taxed. `total = subtotal − discount + deliveryFee + tax`, always.
3. **Order creation is one transaction.** Order, items, first history entry, payment intent, stock reservation and cart checkout commit together or not at all. A request that dies halfway leaves the cart exactly as it was.
4. **404 means "not yours or not there".** Never probe for existence with status codes.
5. **Public store pages need no token**, and personalise with one.
6. **Ownership is enforced in application code**, with RLS on every table as defense in depth. The API uses the service-role key, which bypasses RLS by design.
7. **Nothing is soft-deleted silently.** A withdrawn product is still listed with `isPurchasable: false`, and an order is cancelled rather than removed.
