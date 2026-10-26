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
| 403 | `MERCHANT_REQUIRED` | Signed in with a customer account on a `/merchant` route. A role check, not ownership |
| 403 | `SHOP_ACCOUNT` | A shop account signing in to the customer app, or on any signed-in customer route. Shop and customer accounts are separate logins — to shop, sign up with another email |
| 403 | `CUSTOMER_ACCOUNT` | A customer account signing in to the shop app. To open a shop, sign up with another email |
| 403 | `ACCOUNT_SUSPENDED` | A platform admin suspended this account. Every sign-in (customer, shop, admin) and every signed-in request is refused; the message carries the reason. Public pages still work, as a visitor |
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
| `POST /auth/login` | **public.** `{ email, password }` → `{ customer, session, roles }`, `roles` always `["customer"]`. **401** on bad credentials, with the same message for an unknown email as for a wrong password. A shop account is **403 `SHOP_ACCOUNT`**, and the session the sign-in opened is ended. |
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
| `GET /stores` | **public.** The shop directory: every active, published store, newest first, each in the same shape as `GET /stores/:slug` (with `isSaved: null`). `q` matches the name or city; paged with `page` / `limit` (max 50). |
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

The shopkeeper side uses the same Supabase Auth, but a **shop account and a
customer account are separate logins with separate emails** (MERGE_MAPPING D-2,
revised). A shop account cannot sign in to the customer app or use any customer
route (**403 `SHOP_ACCOUNT`**); a shopkeeper who wants to shop creates a customer
account with another email. Refresh, logout and password reset are the shared
`/auth` endpoints above; sign-in is not.

| | |
|---|---|
| `POST /merchant/auth/register` | **public.** `{ email, password, fullName, phone? }` → **201** `{ merchant, session, emailConfirmationRequired }`. Same rules and wording as `/auth/register`: a taken email is **409**; with email confirmation on, `merchant` and `session` are `null`. |
| `POST /merchant/auth/login` | **public.** `{ email, password }` → `{ merchant, session, roles: ["merchant"] }`. **401** on bad credentials, worded as `/auth/login`. A customer account is **403 `CUSTOMER_ACCOUNT`**, and the session the sign-in opened is ended. A shop sign-up whose merchant profile was never written is finished here. |
| `GET /merchant/me` | Bearer, merchant. `{ merchant, stores: [{ id, name, slug, isPublished, logoUrl }] }`, stores newest first. |
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
| `DELETE /merchant/stores/:storeId` | Bearer, merchant. `{ confirmName }` — the store's name, typed to confirm → **204**. Permanent: the catalogue, stock history, orders, counter sales, khata and photos go with it. A name that does not match is **422**; an order still in progress is **409** (complete or cancel it first). |
| `POST /merchant/stores/:storeId/publish` | Bearer, merchant. No body → `{ store }`. Missing details are **422 `STORE_INCOMPLETE`**, listed in `details.missing`, with `details.verificationStatus` and `details.publishWhenVerified`; already published is **409**. When verification is among the missing, the request is remembered (`store.publishRequestedAt`) and approving the store publishes it — the owner does not have to come back. Unpublishing clears it. |
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
change goes through inventory. Delete archives (migration 0034): the product
leaves every list, the store and the till, and past orders keep pointing at it.
Deactivate to hide it for a while instead.

| | |
|---|---|
| `GET /merchant/stores/:storeId/products` | Bearer, merchant. `?search=&categoryId=&isActive=&lowStock=&page=&limit=` → `{ products }` with pagination `meta`. Inactive products included unless `isActive=true`. `lowStock=true`: some active variant can sell no more than the product's `lowStockThreshold`. |
| `POST /merchant/stores/:storeId/products` | Bearer, merchant. The body below → **201** `{ product }`. One transaction: product, variants, opening stock and images, or nothing. |
| `GET /merchant/stores/:storeId/products/:productId` | Bearer, merchant. `{ product }` |
| `PATCH /merchant/stores/:storeId/products/:productId` | Bearer, merchant. `{ name?, description?, categoryId?, unit?, taxPercent?, trackInventory?, lowStockThreshold?, images? }` → `{ product }`. `categoryId: null` uncategorises; `images` replaces the list. |
| `POST /merchant/stores/:storeId/products/:productId/activate` | Bearer, merchant. No body → `{ product }`. |
| `DELETE /merchant/stores/:storeId/products/:productId` | Bearer, merchant. No body → 204. Archives the product: gone from the merchant's lists, the store and carts; a 404 from then on. Order and stock history keep it. |
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

### Refunds (paid cancellations)

A paid order that ends **cancelled** or **rejected** — by the customer, the
store, or the system — opens a refund in the same database transaction as the
status change (migration 0038). The refund is linked to the order **and** the
payment it returns; there is at most one live refund per payment, so a retried
request or a replayed webhook can never refund twice.

| Refund `status` | Meaning |
|---|---|
| `initiated` | Opened; not yet accepted by the payment partner. |
| `processing` | The payment partner has accepted it and is moving the money. |
| `refunded` | Confirmed — by the payment partner (webhook or status lookup), by the khata credit entry, or by the merchant handing cash back. Only now do the payment and the order say `refunded`. |
| `failed` | Not completed; `failureReason` says why. The store can retry. |

`method` is `provider` (back to the card/UPI/bank), `khata_credit` (a separate
credit entry in the customer's khata at the store — settled at once, the
original charge is never edited) or `cash`. A payment that arrives **after** its
order was cancelled is refunded automatically.

Customers see the refund on `GET /orders/:id` (`order.refund`, with its
`events` timeline and `nextStep`) and on the receipt. Before cancelling,
`order.cancellation` states the rule, whether the order can be cancelled, and
`refundOnCancelPaise`.

| | |
|---|---|
| `GET /merchant/stores/:storeId/refunds` | Bearer, merchant. `?status=initiated,processing&page=&limit=` → `{ refunds }` (each with `orderNumber`), newest first. |
| `GET /merchant/stores/:storeId/refunds/:refundId` | Bearer, merchant. `{ refund }` with its `events`. |
| `POST /merchant/stores/:storeId/refunds/:refundId/retry` | Bearer, merchant. No body. A `failed` gateway refund is sent again → `{ refund }`. Anything else is **409**; a non-gateway refund is **422 `NOT_A_GATEWAY_REFUND`**. |
| `POST /merchant/stores/:storeId/refunds/:refundId/confirm-cash` | Bearer, merchant. `{ note? }`. Records that a cash refund was handed back → `{ refund }`. Not a cash refund: **422 `NOT_A_CASH_REFUND`**. |

Refund webhooks arrive on `POST /payments/webhook` with
`{ event: "refund.processing" | "refund.processed" | "refund.failed", providerRefundRef, eventId?, failureReason? }`,
signed like payment events. Replays (same `eventId`) and out-of-order events (a
`processing` after `refunded`) are acknowledged with **200** and ignored.

```json
"refund": {
  "id": "r1…", "orderId": "o1…", "paymentId": "p1…",
  "status": "processing", "statusLabel": "Refund processing",
  "amountPaise": 38850, "currency": "INR",
  "method": "provider", "methodLabel": "To your original payment method",
  "reference": "mock_rfnd_…", "reason": "Out of stock", "initiatedBy": "store",
  "failureReason": null, "attempts": 1,
  "initiatedAt": "…", "processingAt": "…", "refundedAt": null, "failedAt": null,
  "nextStep": "We have asked the payment partner to return your money. …",
  "isFinal": false,
  "events": [{ "fromStatus": null, "toStatus": "initiated", "label": "Refund initiated", "source": "system", "note": "…", "at": "…" }]
}
```

### Merchant khata

Bearer, merchant, on the caller's own store. The khata is the merchant's
credit ledger with a customer. Entries are **never edited or deleted**: a
mistake is corrected by a reversal entry that points at it, and every entry
records who made it. Outstanding and overdue amounts are computed from the
ledger, oldest charges settled first.

| | |
|---|---|
| `PUT /merchant/stores/:storeId/khata-settings` | Bearer, merchant. `{ khataEnabled?, khataDueDays? }` → `{ settings }`. `khataEnabled` lets customers with a credit limit choose **khata** at checkout. |
| `GET /merchant/stores/:storeId/khata` | Bearer, merchant. `?search=&status=all\|outstanding\|overdue` → `{ accounts, summary: { accountCount, outstandingPaise, overduePaise } }`. |
| `POST /merchant/stores/:storeId/khata` | Bearer, merchant. `{ customerId \| email \| phone, creditLimitPaise?, notes? }` → **201**. `customerId` must have ordered from the store; an email or phone must match exactly one customer (**422 `CUSTOMER_NOT_FOUND`**). One account per customer per store (**409**). |
| `GET /merchant/stores/:storeId/khata/:accountId` | Bearer, merchant. `{ account, totals, openCharges, transactions, reminders }`. |
| `PATCH /merchant/stores/:storeId/khata/:accountId` | Bearer, merchant. `{ creditLimitPaise?, isActive?, notes?, remindersEnabled? }`. A closed account still takes payments and corrections. |
| `POST /merchant/stores/:storeId/khata/:accountId/entries` | Bearer, merchant. **Send `Idempotency-Key`.** `{ kind: charge\|payment\|adjustment, amountPaise, description?, dueDate?, paymentMethod?, direction?, orderId? }` → **201** `{ transaction, replayed, account }`. A charge gets `dueDate` (default: today + the store's `khataDueDays`); an adjustment needs `direction` and a reason (**422 `REASON_REQUIRED`**). |
| `POST /merchant/stores/:storeId/khata/:accountId/entries/:transactionId/reverse` | Bearer, merchant. `{ reason }` → **201**. Adds the opposite entry for the same amount, linked to the original. Already reversed: **409**; a reversal cannot be reversed: **422 `CANNOT_REVERSE_REVERSAL`**. |
| `POST /merchant/stores/:storeId/khata/:accountId/reminders` | Bearer, merchant. `{ note? }` → **201**. Records a snapshot of what is owed and notifies the customer. Nothing owed: **422 `NOTHING_OUTSTANDING`**; reminders off: **422 `REMINDERS_OFF`**. |
| `GET /merchant/stores/:storeId/khata/:accountId/statement` | Bearer, merchant. `?from=&to=&page=&limit=` → opening, debits, credits, closing for the period. |

**Paying on khata.** `POST /orders` accepts `paymentMethod: "khata"` when the
store has `khataEnabled` and the customer has an active account with a credit
limit. The charge is written in the same transaction as the order and must fit
the limit (**422 `KHATA_LIMIT_EXCEEDED`** with `details.availablePaise`; no
credit: **422 `KHATA_UNAVAILABLE`**). Cancelling such an order credits the
amount back as a separate, linked `refund_credit` entry.

### Merchant notifications

The store's inbox: new orders, refunds that completed or failed, low stock,
expiring batches, customer messages.

| | |
|---|---|
| `GET /merchant/stores/:storeId/notifications` | Bearer, merchant. `?unreadOnly=&page=&limit=` → `{ notifications, unreadCount }`, newest first. |
| `POST /merchant/stores/:storeId/notifications/read-all` | Bearer, merchant. No body → `{ updated, unreadCount }`. |
| `POST /merchant/stores/:storeId/notifications/:notificationId/read` | Bearer, merchant. No body → `{ notification }`. Idempotent. |

### Store verification (KYC)

A store is **verified before it is published** (migration 0039; the database
refuses `is_published = true` on an unverified store, behind the API's own
check — `POST …/publish` lists `verification` in `details.missing`). A reviewer
revoking a verification unpublishes the store at once.

| `verificationStatus` | Meaning |
|---|---|
| `not_submitted` | Details and documents can be edited. |
| `pending` | Submitted; locked while a reviewer looks at it. |
| `verified` | Approved. The store may be published. |
| `rejected` | `rejectionReason` says what to fix; editable again, then resubmitted. |

Documents go to a **private** bucket: JPEG, PNG, WebP or PDF, at most 5 MB,
type read from the bytes (**422 `DOCUMENT_INVALID`**), images re-encoded so
their metadata (GPS, camera) is dropped. A document is never a public URL; the
owner or a reviewer gets a link valid for 5 minutes. No identity number is
collected as text — mask the Aadhaar number on an Aadhaar card.

Required to submit: legal name, business type, owner name and phone, a shop
photo, identity proof and address proof — plus a GSTIN and the GST certificate
when `gstApplicable` (**422 `VERIFICATION_INCOMPLETE`** with
`details.missing`).

| | |
|---|---|
| `GET /merchant/stores/:storeId/verification` | Bearer, merchant. `{ verification: { status, statusLabel, isEditable, details, documents, requiredDocuments, missing, rejectionReason, reviewNote, events } }`. |
| `PUT /merchant/stores/:storeId/verification` | Bearer, merchant. `{ legalName?, businessType?, gstApplicable?, gstin?, ownerName?, ownerPhone?, ownerEmail?, businessAddress? }`. While `pending` or `verified`: **409**. |
| `POST /merchant/stores/:storeId/verification/documents/:docType` | Bearer, merchant. Multipart `file` → **201**. `docType`: `gst_certificate`, `shop_photo`, `identity_proof`, `business_proof`, `address_proof`, `other`. Replaces the current one of that type; the old one stays on record. |
| `DELETE /merchant/stores/:storeId/verification/documents/:documentId` | Bearer, merchant. Withdraws a document before submission. |
| `GET /merchant/stores/:storeId/verification/documents/:documentId/url` | Bearer, merchant. `{ document, url, expiresInSeconds }`. |
| `POST /merchant/stores/:storeId/verification/submit` | Bearer, merchant. No body → `pending`. |

### Platform admin portal

The admin portal (`/admin`) is run by one kind of admin, who can do
everything: an auth user with a `platform_admins` row (migrations 0039, 0045,
0046). The operator makes one with `npm run admin -- grant <email>` (the seed
also makes `demo.admin@cpse.local`); there is no way to add admins from the
API. Any customer or shop account gets **403 `FORBIDDEN`** on every route
here. An admin account — your own included — cannot be suspended. Every
decision is written to the append-only action log (`admin_actions`) with the
admin, the reason and the target; store decisions are also in the store's
verification events.

| | |
|---|---|
| `POST /admin/auth/login` | **public.** `{ email, password }` → `{ admin: { id, email, fullName }, session, roles: ["admin"] }`. Not an admin: **403**, and the session is ended. Suspended: **403 `ACCOUNT_SUSPENDED`**. |
| `GET /admin/me` | Bearer, admin. `{ admin: { id, email, fullName } }`. |
| `GET /admin/overview` | Admin. `{ overview: { you: { id, email }, stores: { total, published, waitingForReview, sentBack, waitingToPublish }, accounts: { total, merchants, customers, suspended }, support: { escalated }, recentActions } }`. |
| `GET /admin/verifications` | Admin. `?status=pending&page=&limit=` → `{ stores }`, oldest first. |
| `GET /admin/verifications/:storeId` | Admin. `{ store: { …, publishRequestedAt }, verification }` — `publishRequestedAt` set means approving also publishes the store. |
| `GET /admin/verifications/:storeId/documents/:documentId/url` | Admin. A 5-minute link to one document. |
| `POST /admin/verifications/:storeId/approve` | Admin. `{ note? }`. `pending` → `verified`. If the owner already pressed Publish and nothing else is missing, the store is published in the same step (`published: true` in the reply) and the owner is told it is live. |
| `POST /admin/verifications/:storeId/reject` | Admin. `{ reason, note? }` (reason 3–500 characters). `pending` → `rejected` (sent back), or `verified` → `rejected` (verification revoked — the store is unpublished). |
| `GET /admin/stores` | Admin. `?search=&verification=pending\|verified\|rejected\|not_submitted&published=yes\|no&page=&limit=` → `{ stores: [{ id, name, slug, city, shopCategory, isPublished, verificationStatus, verificationLabel, publishRequestedAt, owner: { id, email, name, phone, isSuspended } }] }`, newest first. |
| `GET /admin/stores/:storeId` | Admin. `{ store: { …, phone, email, address, missingForPublish }, counts: { products, orders, ordersLast30Days }, actions }`. |
| `POST /admin/stores/:storeId/unpublish` | Admin. `{ reason }` → the store detail. Customers stop seeing the store; open orders carry on; the owner is told why and may publish again once fixed (revoke verification to stop that). **409** if not published. |
| `GET /admin/accounts` | Admin. `?kind=all\|customer\|merchant&status=all\|active\|suspended&search=&page=&limit=` → `{ accounts: [{ id, email, name, phone, type: customer\|merchant\|admin, isSuspended, suspendedAt, suspendedReason, storeCount, orderCount, createdAt }] }`. `search` matches email, name or phone. |
| `GET /admin/accounts/:accountId` | Admin. `{ account, stores, actions }`. |
| `POST /admin/accounts/:accountId/suspend` | Admin. `{ reason }`. The account can no longer sign in anywhere and its open sessions are refused (Supabase Auth ban as well). **403** for any admin account, your own included; **409** if already suspended. |
| `POST /admin/accounts/:accountId/reinstate` | Admin. `{ reason }`. **409** if not suspended. |
| `GET /admin/log` | Admin. `?targetType=store\|account\|admin&action=&page=&limit=` → `{ actions: [{ id, at, admin: { id, email }, action, target: { type, id, label }, reason, details }] }`, newest first. |

### Merchant catalogue operations

Bearer, merchant, on the caller's own store. These save repeated work; every
write goes through the same product, variant and inventory rules a hand edit
does (roadmap §4 P1).

**Industry templates and workflow defaults.** Seven templates — `grocery`,
`pharmacy`, `clothing`, `electronics`, `bakery`, `stationery`, `general` — each
with categories, starter products (units, variants, suggested prices and the
usual GST rate) and workflow defaults. A template is a starting point: what it
creates is ordinary, editable data, and applying it again skips anything the
store already has (by name), never overwriting. New products take the store's
defaults for anything the request leaves out.

| | |
|---|---|
| `GET /merchant/templates` | Bearer, merchant. `{ templates: [{ industry, label, categoryCount, productCount, defaults }] }`. |
| `GET /merchant/templates/:industry` | Bearer, merchant. `{ template }` with every starter product and its `suggestedPricePaise`. |
| `POST /merchant/stores/:storeId/templates/apply` | Bearer, merchant. `{ industry, applyDefaults?, categories?: "all" \| [names], products?: "all" \| [{ key, name?, taxPercent?, prices?: { "<variant name>": paise } }] }` → **201** `{ report: { categoriesCreated, categoriesSkipped, productsCreated, productsSkipped, failed } }`. Products are created with no stock. |
| `GET /merchant/stores/:storeId/defaults` | Bearer, merchant. `{ defaults: { lowStockThreshold, taxPercent, trackInventory, expiryAlertDays, templateApplied } }`. |
| `PUT /merchant/stores/:storeId/defaults` | Bearer, merchant. Any of `{ lowStockThreshold, taxPercent, trackInventory, expiryAlertDays }`. |

**Units.** `pcs` (piece), `kg`, `g`, `l` (litre), `ml`, `dozen`, `pack`
(packet), `box`, plus `m`, `cm`, `pair`, `set`, `roll`, `plate`, `serving`. A
variant's `weightGrams` lets customers see a price per kg.

**Categories.**

| | |
|---|---|
| `PUT /merchant/stores/:storeId/categories/order` | Bearer, merchant. `{ categoryIds }` — every category of the store, once each, in the new order (**422 `CATEGORY_SET_MISMATCH`** otherwise). → `{ categories }`. |
| `DELETE /merchant/stores/:storeId/categories/:categoryId` | Bearer, merchant. `{ moveToCategoryId? , uncategorise? }`. A category that still has products is **409** (with `details.productCount`) unless they are moved or explicitly left uncategorised. → `{ movedProducts, categories }`. |

**Duplicate and lookup.**

| | |
|---|---|
| `POST /merchant/stores/:storeId/products/:productId/duplicate` | Bearer, merchant. `{ name? }` → **201** `{ product }`: same details and variants, new SKUs, no barcodes, no stock, **inactive** until edited. |
| `GET /merchant/stores/:storeId/product-lookup` | Bearer, merchant. `?barcode=` or `?sku=` → `{ product, variant }`, or **404**. Barcodes are unique per store: a clash on create, new option or edit is **409 `BARCODE_TAKEN`** naming the product that has it ("Basmati Rice (1 kg) already has barcode 8901234567890.", `details: { barcode, productId, variantId, productName }`); the same code twice in one request is **422**. Send `barcode: null` to remove one. The product list's `search` also matches SKUs and barcodes. |
| `GET /merchant/stores/:storeId/barcode-library` | Bearer, merchant. `?barcode=` (4–100 letters, digits or hyphens) → `{ library: { barcode, found, shops, agreeing, suggestion: { name, optionName, unit, taxPercent, mrpPaise, weightGrams, category: { name, id } \| null } \| null, note } }` — what **other** shops entered for this barcode, for pre-filling a new product. Only what is printed on the pack is shared; never a shop's selling price, cost, stock, photos or identity. Where shops disagree, the answer most of them gave wins (once per shop); `category.id` is the caller's own category of that name, if any. Archived products and inactive stores are left out. `found: false` when no other shop has the code. |

**Suppliers and purchases.** A purchase is a draft until confirmed. Confirming
puts every line on the shelf as a `purchase` stock movement that references
the purchase and records its unit cost (the variant's cost becomes the latest
purchase cost), and opens a batch when the line has a batch number or expiry.
A confirmed purchase is never edited; return goods with a stock-out
(`returned_to_supplier`). The same supplier invoice number twice is **409**.

| | |
|---|---|
| `GET /merchant/stores/:storeId/suppliers` | Bearer, merchant. `?includeInactive=` → `{ suppliers }`. |
| `POST /merchant/stores/:storeId/suppliers` | Bearer, merchant. `{ name, phone?, email?, gstin?, address?, notes? }` → **201**. Names are unique per store. |
| `PATCH /merchant/stores/:storeId/suppliers/:supplierId` | Bearer, merchant. Any field above, or `isActive`. |
| `GET /merchant/stores/:storeId/purchases` | Bearer, merchant. `?status=&supplierId=&page=&limit=` → `{ purchases }`. |
| `POST /merchant/stores/:storeId/purchases` | Bearer, merchant. `{ supplierId? \| supplierName?, invoiceNumber?, invoiceDate?, purchaseDate?, notes?, items: [{ variantId, quantity, unitCostPaise, taxPaise?, batchNumber?, manufacturedOn?, expiresOn? }], confirm? }` → **201** `{ purchase }`. |
| `GET /merchant/stores/:storeId/purchases/:purchaseId` | Bearer, merchant. `{ purchase }` with `items`. |
| `PUT /merchant/stores/:storeId/purchases/:purchaseId` | Bearer, merchant. Same body; replaces a **draft** (**409** otherwise). |
| `POST /merchant/stores/:storeId/purchases/:purchaseId/confirm` | Bearer, merchant. No body. Idempotent. An empty purchase: **422 `PURCHASE_EMPTY`**; an untracked product: **422 `NOT_TRACKED`**. |
| `POST /merchant/stores/:storeId/purchases/:purchaseId/cancel` | Bearer, merchant. Drafts only. |

**Batches and expiry.** `POST …/inventory/stock-in` also takes `batchNumber`,
`manufacturedOn`, `expiresOn` to open a batch; `POST …/inventory/stock-out`
takes `batchId` to take from one lot (an expired one being written off). As
stock leaves the shelf, batches are drawn down first-expiring first — expired
lots last, except for an `expired` write-off, which takes them first.

| | |
|---|---|
| `GET /merchant/stores/:storeId/inventory/batches` | Bearer, merchant. `?status=active\|expiring\|expired\|all&variantId=&page=&limit=` → `{ batches, summary: { expiringCount, expiredCount, expiredQuantity } }`, soonest expiry first. Each batch has `expiresOn`, `daysToExpiry`, `expiryState` (`ok`, `expiring` — within the store's `expiryAlertDays` — `expired`, `no_expiry`), `quantityRemaining`. |

**Import / export and bulk actions.** Prices in the CSV are rupees (`120.50`).
A product whose rows contain any error is skipped whole and every failed line is
reported; the rest is applied product by product.

| | |
|---|---|
| `GET /merchant/stores/:storeId/catalogue/export` | Bearer, merchant. `text/csv`, one row per variant: `product_name, category, unit, tax_percent, track_inventory, low_stock_threshold, product_active, variant_name, sku, barcode, weight_grams, price, mrp, cost, quantity_on_hand, variant_active`. Cells a spreadsheet would run as formulas are prefixed with `'`. |
| `POST /merchant/stores/:storeId/catalogue/import` | Bearer, merchant. Body: the CSV, `Content-Type: text/csv`, ≤ 2 MB, ≤ 5,000 rows. `?mode=preview` (default) → `{ rowCount, failedRows: [{ line, productName, errors }], products, summary }` and writes nothing; `?mode=commit` → `{ results: [{ line, status: created\|updated\|skipped\|failed, errors? }], summary }`. Matching is by SKU, then by product and variant name. A changed `quantity_on_hand` is a logged stock adjustment ("Catalogue import"). Missing `product_name`/`price` columns: **422 `IMPORT_HEADERS`**; empty: **422 `IMPORT_EMPTY`**; too many rows: **422 `IMPORT_TOO_LARGE`**. |
| `POST /merchant/stores/:storeId/products/bulk` | Bearer, merchant. `{ action, productIds (≤ 200), preview (default true), … }` with `action` one of `archive`, `activate`, `deactivate`, `set_category { categoryId }`, `set_tax { taxPercent }`, `set_low_stock_threshold { threshold }`, `adjust_price_percent { percent }`, `stock_in { quantity, notes? }`. → `{ bulk: { results: [{ productId, status: ok\|applied\|failed, before, after, errors? }], summary } }`. A price change that would exceed a variant's MRP fails that product, not the batch. |

### Customer preferences, lists and repeat shopping

Bearer, customer — always the caller's own data. Nothing here bypasses the
cart: adding a list or a usual basket goes through `POST /cart/items` rules, so
price, stock and availability are checked as for any tap on "Add".

| | |
|---|---|
| `GET /me/preferences` | Bearer. `{ preferences: { birthday, activityTracking, occasionOffers, preferredFulfilment, preferredPaymentMethod, preferredSubstitution, preferredLanguage, defaultAddressId } }`. A payment preference is a method name only — no card, UPI or bank detail is stored. |
| `PATCH /me/preferences` | Bearer. Any of the above (birthday as `{ month, day }`, no year). Turning `activityTracking` off also deletes the recorded activity. |
| `GET /me/store-preferences` | Bearer. Every store's communication choices the customer has set. |
| `GET /stores/:storeId/preferences` | Bearer. This store's communication choices: `allowPromotions` (offers, announcements, occasion offers — off by default), `allowReminders`, `allowSms`, `allowWhatsapp`, `allowEmail`. Updates about an order you placed always reach you in the app. |
| `PUT /stores/:storeId/preferences` | Bearer. Any of those switches. |
| `POST /me/events` | Bearer. `{ eventType: store_view\|product_view\|search\|cart_remove\|checkout_start\|offer_view, storeId?, productId?, variantId?, query?, sessionId? }` → `{ recorded }`. Not recorded when tracking is off, or when the ids do not belong together. `cart_add` and `cart_abandon` are **refused (422)** here: the server records them itself — `cart_add` when an item is actually saved to a cart (any path: product page, buy again, lists, usual basket, reorder), with `{ quantity }` only; `cart_abandon` from the `abandoned-carts` job for an open cart with items, idle for 24 hours (and at most 30 days), not ordered since, once per cart per idle spell (unique `dedupe_key`). Neither is recorded when tracking is off, and neither carries prices. |
| `GET /me/recently-viewed` | Bearer. `?storeId=` → `{ products }` (live price and availability). |
| `GET /me/recently-purchased` | Bearer. `?storeId=` → `{ products }`, most recent first. |
| `GET /me/buy-again` | Bearer. `?storeId=` → `{ products }` with `timesBought`, `usualQuantity`, `usualVariantId`, `lastBoughtAt`. |
| `GET /me/smart-cart` | Bearer. `?storeId=` → `{ smartCart: { rule, basedOnOrders, usual, missingFromCart } }` — products in at least half of the customer's last ten completed orders at the store. |
| `POST /me/smart-cart/add` | Bearer. `{ storeId, onlyMissing? }` → `{ added, failed, isComplete }`. |
| `GET /me/insights` | Bearer. Deterministic metrics from the customer's own completed orders: frequent products and categories, favourite stores, purchase frequency, average order value, repeat rate, last purchase, common baskets, preferred fulfilment/payment/substitution, abandoned carts — each with its definition. |
| `GET /me/favourites` | Bearer. `?storeId=` → `{ products }`. |
| `POST /me/favourites/:productId` | Bearer. No body. Idempotent. |
| `DELETE /me/favourites/:productId` | Bearer. Idempotent. |
| `GET /me/lists` | Bearer. `?kind=list\|template` → `{ lists }`. |
| `POST /me/lists` | Bearer. `{ name, kind?, storeId?, repeatEveryDays?, items? }` → **201**. A template (a recurring basket) belongs to one store; `repeatEveryDays` sets a reminder rhythm. |
| `GET /me/lists/:listId` | Bearer. `{ list }` — items with the live product, or a free-text `label`. |
| `PATCH /me/lists/:listId` | Bearer. `{ name?, repeatEveryDays? }`. |
| `DELETE /me/lists/:listId` | Bearer. |
| `POST /me/lists/:listId/items` | Bearer. `{ productId? \| label?, variantId?, quantity?, note? }` → **201**. |
| `PATCH /me/lists/:listId/items/:itemId` | Bearer. `{ quantity?, note?, isChecked? }`. |
| `DELETE /me/lists/:listId/items/:itemId` | Bearer. |
| `POST /me/lists/:listId/add-to-cart` | Bearer. `{ storeId? }` → `{ added, failed, skipped, isComplete }`. Unchecked product lines of that store go into its cart. |
| `POST /checkout/quick` | Bearer. `{ storeId }` → `{ settings: { fulfilmentMode, addressId, paymentMethod, substitutionPreference }, quote }` — the normal quote for the customer's saved choices, where the store allows them. Nothing is placed; the customer confirms with `POST /orders`. |

**Coupons and points at checkout.** `POST /checkout/quote` and `POST /orders`
also take `couponCode`, `redeemPoints` and `substitutionPreference`
(`contact_me`, `allow_similar`, `no_substitutions`). The quote returns
`benefits: { coupon, loyalty: { balancePoints, maxRedeemablePoints, pointsUsed, discountPaise, pointValuePaise } }`,
`freeDelivery: { thresholdPaise, remainingPaise, isUnlocked }`, and blockers
`COUPON_INVALID` (with `reason`), `NOT_STACKABLE`, `INSUFFICIENT_POINTS`,
`BELOW_MIN_REDEEM`, `ABOVE_MAX_REDEEM`, `LOYALTY_UNAVAILABLE`. A discount is
spread over the lines in proportion to their value, and each line's tax is on
its price after its share (`lines[].discountPaise`). Order creation re-checks
the coupon's window and both usage limits, the points balance and every offer
under row locks, and refuses (**422 `COUPON_INVALID`**, **`INSUFFICIENT_POINTS`**,
**`OFFER_ENDED`**) rather than honour what has gone. Cancelling or rejecting
the order releases the coupon use and returns the points; completing it earns
points.

| | |
|---|---|
| `GET /me/loyalty` | Bearer. `{ accounts: [{ store, points, lifetimeEarned }] }`. |
| `GET /stores/:storeId/loyalty` | Bearer. `{ loyalty: { store, program, balance: { points, valuePaise, … }, rewards (with canRedeem), history } }`. |
| `POST /stores/:storeId/loyalty/rewards/:rewardId/redeem` | Bearer. No body → **201** `{ coupon, … }`: the points are taken and a personal single-use coupon is issued, in one transaction. Not enough points: **422 `INSUFFICIENT_POINTS`**. |

**Local offers (public).** An offer is shown and priced only while it is live
— inside its window, with offer units left, and short of its batch's safety
cut-off — checked on every read and again when the order is placed. A cart
line takes the offer price only if the offer can sell its whole quantity;
otherwise a notice says how many are left at that price.

| | |
|---|---|
| `GET /stores/:slug/offers` | **public.** `{ offers, coupons }` — live offers, and the store's coupons (personalised with eligibility when signed in). |
| `GET /offers/nearby` | **public.** `?lat=&lng=&limit=` → `{ offers }`: live offers from published stores whose radius covers that point, nearest first, each with `store`, `distanceKm`, `offerPricePaise`, `listPricePaise`, `endsAt`, `unitsLeft`. |

### Merchant CRM, loyalty, coupons and offers

Bearer, merchant, on the caller's own store. CRM figures are computed from this
store's own transactions only; segments are deterministic: **prospect** (no
completed order), **new** (one, within 60 days), **active** (two or more, last
within 60 days), **loyal** (five or more in 180 days, last within 60),
**inactive** (none in 60 days).

| | |
|---|---|
| `GET /merchant/stores/:storeId/customers` | Bearer, merchant. `?segment=&search=&sort=last_order\|total_spend\|orders\|name&page=&limit=` → `{ customers, segments, rules }`. Each: name, phone, segment, order count, total spend, average order, first/last order, median days between orders, follower, consent, khata balance, points, tags. |
| `GET /merchant/stores/:storeId/customers/:customerId` | Bearer, merchant. `{ customer }` plus favourite products (repeat purchases and hearted), khata, purchase history at this store, notes. Someone who never dealt with the store is **404**. |
| `PATCH /merchant/stores/:storeId/customers/:customerId` | Bearer, merchant. `{ notes?, tags? }`. |
| `GET /merchant/stores/:storeId/customers/:customerId/points` | Bearer, merchant. `{ history }`. |
| `POST /merchant/stores/:storeId/customers/:customerId/points` | Bearer, merchant. `{ points (signed), reason }` → **201** `{ balance, history }`. An adjustment entry, never an edit; below zero is **422 `INSUFFICIENT_POINTS`**. |
| `GET /merchant/stores/:storeId/loyalty` | Bearer, merchant. `{ program }`. |
| `PUT /merchant/stores/:storeId/loyalty` | Bearer, merchant. `{ isActive?, earnPointsPer100?, pointValuePaise?, minOrderPaiseToEarn?, minRedeemPoints?, maxRedeemPercent?, welcomeBonusPoints?, pointsExpireDays? }`. |
| `GET /merchant/stores/:storeId/loyalty/rewards` | Bearer, merchant. `{ rewards }`. |
| `POST /merchant/stores/:storeId/loyalty/rewards` | Bearer, merchant. `{ name, description?, pointsCost, discountType: flat\|percent\|free_delivery, amountOffPaise? \| percentOff? }` → **201**. A mismatched value is **422 `REWARD_INVALID`**. |
| `PATCH /merchant/stores/:storeId/loyalty/rewards/:rewardId` | Bearer, merchant. Any of those, or `isActive`. |
| `GET /merchant/stores/:storeId/loyalty/members` | Bearer, merchant. `{ members }`, highest balance first. |
| `GET /merchant/stores/:storeId/coupons` | Bearer, merchant. `{ coupons }` with `timesUsed` and `totalDiscountPaise`. |
| `POST /merchant/stores/:storeId/coupons` | Bearer, merchant. `{ code, title, discountType: percent\|flat\|free_delivery, percentOff? \| amountOffPaise?, maxDiscountPaise?, minOrderPaise?, startsAt?, endsAt?, maxUses?, maxUsesPerCustomer?, audience: all\|new\|returning\|loyal\|followers\|birthday, stackableWithLoyalty?, description? }` → **201**. A code used before: **409**; an impossible setup: **422 `COUPON_INVALID_SETUP`**. `new` is a first order at this store; `birthday` needs the customer's birthday week and their consent. |
| `PATCH /merchant/stores/:storeId/coupons/:couponId` | Bearer, merchant. Any of those, or `isActive`. |
| `GET /merchant/stores/:storeId/offers` | Bearer, merchant. `?status=all\|live\|scheduled\|ended` → `{ offers }`, each with `endReason`. |
| `POST /merchant/stores/:storeId/offers` | Bearer, merchant. `{ kind: expiry\|promotion, variantId, batchId?, title, description?, offerPricePaise, startsAt?, endsAt, quantityLimit?, radiusKm?, expiryCutoffDays? }` → **201**. An expiry offer needs its batch (**422 `BATCH_REQUIRED`**), is capped at what is left of it, and is refused inside the safety cut-off (**422 `PAST_EXPIRY_CUTOFF`**); the price must be below the normal one (**422 `OFFER_NOT_LOWER`**); one live offer per variant (**409**). Also **422 `BATCH_EMPTY`**. |
| `POST /merchant/stores/:storeId/offers/:offerId/end` | Bearer, merchant. No body. |

### Conversations, substitutions and support

A conversation is between one customer and one store (and, for an order, that
order). Messages are never edited. `kind`: `question` (ask the shop),
`special_request` (with `requestType`: `custom_item`, `packaging`,
`delivery_time`, `bulk_order`, `other`), `order`, `support`. `status`:
`awaiting_store`, `awaiting_customer`, `resolved`, `escalated`. Every new
message notifies the other side; a customer writing again reopens a resolved
conversation.

| | |
|---|---|
| `GET /conversations` | Bearer. `?orderId=` → `{ conversations }`, most recent first, each with `isUnread`. |
| `POST /conversations` | Bearer. `{ kind, storeId? \| orderId?, productId?, requestType?, subject, message }` → **201** `{ conversation }`. `order`/`support` need an `orderId` of the caller's own order; a product must belong to the store. |
| `GET /conversations/:conversationId` | Bearer. `{ conversation }` with `messages`; marks it read. Another customer's is **404**. |
| `POST /conversations/:conversationId/messages` | Bearer. `{ body }` (1–2000 characters) → **201**. |
| `POST /conversations/:conversationId/escalate` | Bearer. `{ reason }` → the conversation moves to CPSE support (`escalated`). Only conversations about an order (**409** otherwise). |
| `POST /conversations/:conversationId/resolve` | Bearer. No body. |
| `GET /merchant/stores/:storeId/conversations` | Bearer, merchant. `?status=&kind=` → `{ conversations }`. |
| `GET /merchant/stores/:storeId/conversations/:conversationId` | Bearer, merchant. `{ conversation }` with `messages`; marks it read. |
| `POST /merchant/stores/:storeId/conversations/:conversationId/messages` | Bearer, merchant. `{ body, resolve? }` → **201**. |
| `GET /admin/support` | Admin. Escalated conversations, oldest escalation first. |
| `GET /admin/support/:conversationId` | Admin. Only an escalated conversation (**404** otherwise). |
| `POST /admin/support/:conversationId/messages` | Admin. `{ body, resolve? }` → **201**; the customer is notified. |

**Substitutions.** Only with the customer's agreement: an order's
`substitutionPreference` is `contact_me` (every proposal waits for the
customer), `allow_similar` (a replacement that costs no more is applied at
once, and the customer told), or `no_substitutions` (the store cannot propose
one — **409 `NO_SUBSTITUTIONS`**). The customer never pays more: a dearer
replacement is charged at the original line's price. Applying one moves the
stock reservation, keeps the replaced line on the order as `replacedItems`,
recomputes the totals, and — for a prepaid order that now costs less — opens an
`adjustment` refund for the difference (listed in `order.refundAdjustments`;
a khata one is credited at once).

| | |
|---|---|
| `POST /merchant/stores/:storeId/orders/:orderId/substitutions` | Bearer, merchant. `{ orderItemId, variantId, quantity?, note? }` → **201** `{ substitution }`. Only before the order is ready (**409**); one pending proposal per line (**409**); the same item is **422 `SAME_ITEM`**. |
| `POST /merchant/stores/:storeId/substitutions/:substitutionId/withdraw` | Bearer, merchant. No body. A pending proposal only. |
| `POST /substitutions/:substitutionId/respond` | Bearer, customer. `{ approve, note? }` → `{ substitution }`. A replacement that has since sold out is **422 `SUBSTITUTE_UNAVAILABLE`**; an answered one is **409**. |

**Announcements.** Reach only customers who saved the store **and** turned
promotions on for it; at most three a day (**429**).

| | |
|---|---|
| `GET /merchant/stores/:storeId/announcements` | Bearer, merchant. `{ announcements, audience: { followers, optedIn } }`. |
| `POST /merchant/stores/:storeId/announcements` | Bearer, merchant. `{ title, body? }` → **201** `{ announcement }` with `recipientCount`. |

### Analytics, alerts, suggestions and recurring tasks

Bearer, merchant, on the caller's own store.

| | |
|---|---|
| `GET /merchant/stores/:storeId/analytics` | Bearer, merchant. `?from=YYYY-MM-DD&to=YYYY-MM-DD` (default: the last 30 days, store timezone; at most a year — **422 `PERIOD_TOO_LONG`**; `from` after `to` — **422 `PERIOD_INVALID`**) → `{ analytics: { period, sales (gross, orders, counter, refunds, average ticket, daily trend), orders (by status, cancellation rate, median minutes to accept, by fulfilment), products (bestSellers, slowMovers, unavailable), customers (segments, new and returning buyers), khata (outstanding, overdue, collected, charged), definitions } }`. Completed orders count once, on their completion day; cancelled and rejected orders are never sales; refunds are reported separately, not subtracted. |
| `GET /merchant/stores/:storeId/low-stock` | Bearer, merchant. `{ items }` — counted, active variants at or under their product's alert level, emptiest first. |
| `GET /merchant/stores/:storeId/purchase-suggestions` | Bearer, merchant. `?coverDays=14&lookbackDays=30` → `{ suggestions: { suggestions: [{ productName, variantName, available, onDraftPurchases, soldLastPeriod, dailyRate, suggestedQuantity, lastCostPaise, estimatedCostPaise, reason }] } }`. Deterministic: enough to cover `coverDays` at the recent selling rate and at least one above the alert level, less what is available and already on draft purchases. |
| `POST /merchant/stores/:storeId/purchase-suggestions/draft` | Bearer, merchant. `{ supplierId?, items: [{ variantId, quantity, unitCostPaise }] }` → **201** `{ purchase }` as a **draft**. Nothing reaches the shelf until it is confirmed. |
| `GET /merchant/stores/:storeId/tasks` | Bearer, merchant. `{ tasks }` — recurring operations, next run first. |
| `POST /merchant/stores/:storeId/tasks` | Bearer, merchant. `{ title, taskType: reminder\|low_stock_report\|expiry_report\|purchase_suggestions\|khata_overdue_report, frequency: daily\|weekly\|monthly, dayOfWeek? (0 = Sunday), dayOfMonth? (1–28), timeOfDay? (HH:MM, store time) }` → **201**. At each run the store's inbox gets the report. |
| `PATCH /merchant/stores/:storeId/tasks/:taskId` | Bearer, merchant. Any of those, or `isActive`. |
| `DELETE /merchant/stores/:storeId/tasks/:taskId` | Bearer, merchant. |
| `PUT /merchant/stores/:storeId/khata-settings/auto-reminders` | Bearer, merchant. `{ enabled }` — weekly automatic reminders for overdue khata accounts (customers who turned reminders off are skipped). Off by default. |

**Scheduled jobs** (`src/jobs`, run in-process when `JOBS_ENABLED=true`, or
once each by `npm run db:maintenance`): expire unpaid orders, reconcile
refunds, end offers, low-stock alerts (one per variant per day), expiry alerts
(one per batch and state), recurring tasks, reorder and template reminders,
khata reminders (opt-in), points expiry, support escalation (order conversations
unanswered by the shop for 24 hours go to CPSE support), abandoned-cart events, and
notification deliveries. Each
takes a lease so several instances never run the same job at once, and logs
every run in `job_runs`.

**Notification delivery.** Every notification is delivered in the app; SMS,
WhatsApp and email are attempted only where the customer opted in for that
store (promotional ones only with promotions consent), through
`NOTIFY_CHANNEL_PROVIDER`. With no provider configured an attempt is recorded
as `skipped` with the reason — never claimed as sent.

| | |
|---|---|
| `GET /notifications/:id/deliveries` | Bearer. `{ deliveries: [{ channel, status: delivered\|pending\|sent\|failed\|skipped, attempts, lastError, deliveredAt }] }`. |


### Intelligence (forecasts, suggestions, assistants)

Roadmap Phase D/E and §5 P6. **Every endpoint here is read-only** — the POSTs
carry text or a file to read, not changes to make. Everything except the two
photo endpoints (`recognize`, `invoice-file`) is deterministic — no model is
called, so the same data gives the same answer. Those two ask a vision model
(`AI_PROVIDER=gemini`) to read the file, then validate and match its answer
against the shop's own records like any other input.
What they suggest is applied only when a person confirms it through the
ordinary endpoint a proposal names.

Merchant — bearer, merchant, on the caller's own store:

| | |
|---|---|
| `GET /merchant/stores/:storeId/intelligence/stock` | `?horizonDays=14&leadDays=7` → `{ stock: { today, counts, items: [{ productId, variantId, name, available, soldLast30, forecast: { confidence: insufficient\|low\|medium\|high, reason, dailyAverage, nextDaysUnits }, health: { status: stockout\|at_risk\|overstock\|slow\|healthy\|unknown\|untracked, daysOfCover, note }, proposedReorderQuantity }], method } }`. No forecast with under 14 days of history or under 3 selling days — it says so instead. |
| `POST /merchant/stores/:storeId/intelligence/product-suggestions` | `{ name }` → `{ suggestion: { suggestions: { category, unit, taxPercent, weightGrams, variants }, duplicates, related, nextActions, note } }`, each suggestion with its reason; from the store's own products first, then the industry templates. |
| `POST /merchant/stores/:storeId/intelligence/invoice` | `{ text }` (pasted invoice) → `{ invoice: { invoiceNumber, invoiceDate, statedTotalPaise, computedTotalPaise, totalMatches, lines: [{ source, readAs, match, confidence, warnings, alternatives }], skipped } }`. **422 `NOTHING_READ`** when no line has a name, quantity and price. Nothing is saved; the purchase is created as usual. |
| `POST /merchant/stores/:storeId/intelligence/invoice-file` | Multipart, field `file` (JPEG/PNG/WebP photo or PDF, ≤ 5 MB) → the same `{ invoice }` as `/invoice` plus `source: "file"` and `transcript` (the lines the vision model read, which then go through the same text reader and checks). Lines without a whole quantity and a price are listed in `skipped`. **422 `NOTHING_READ`**, **422 `IMAGE_INVALID`**, **502 `AI_BAD_RESPONSE`** (unusable model answer), **503 `AI_UNAVAILABLE`** (no provider configured, or busy). Write-rate limited. Nothing is saved. |
| `POST /merchant/stores/:storeId/intelligence/recognize` | Multipart, field `file` (JPEG/PNG/WebP photo, ≤ 5 MB; PDFs → 422 `IMAGE_INVALID`) → `{ recognition: { read: { isProduct, name, brand, sizeText, category, barcode, mrpRupees, mrpPaise, weightGrams, confidence }, identified, match: { productId, variantId, name, by: barcode\|name, score, isAvailable, pricePaise } \| null, candidates: [ … up to 3 ], suggestion: { name, category, unit, taxPercent, weightGrams, mrpPaise, barcode, duplicates } \| null, note } }`. `identified` is false below confidence 0.5 or when no product is seen. A readable barcode matches exactly; otherwise names are compared with the shop's catalogue. `suggestion` (for the New product form) only when nothing in the shop matches. **502 `AI_BAD_RESPONSE`**, **503 `AI_UNAVAILABLE`**. Write-rate limited. Nothing is saved. |
| `POST /merchant/stores/:storeId/intelligence/command` | `{ text }` (typed or spoken: "add 10 basmati rice 1 kg", "set price of sugar to 45", "mark ghee out of stock") → `{ command: { understood, proposal: { summary, apply: { method, path, body }, requiresConfirmation: true } \| null, problem, options } }`. |
| `POST /merchant/stores/:storeId/intelligence/ask` | `{ question }` → `{ reply: { kind: answer\|proposal\|help, intent, answer, data, source, actions } }` — sales, best and slow sellers, what is running low, forecast, khata owed, open orders; commands are answered with a proposal. |
| `GET /merchant/stores/:storeId/intelligence/area` | `{ area: { city, minStores, otherStores, benchmarks: [{ name, basis: per_kg\|per_pack, yourPricePaise, area: { stores, p25, median, p75 }, position }], popularNearby, note } }`. Only from **at least 5 other shops** in the same city, one figure per shop, never naming a shop. |
| `GET /merchant/stores/:storeId/products/:productId/alternatives` | Similar, buyable products for a replacement — the same engine as the customer's. |

Customer:

| | |
|---|---|
| `GET /stores/:slug/smart-search` | Public. `?q=` in plain words ("2 kg basmati under 300", "cheapest atta", "milk on offer") → `{ search: { interpretation, parsed, results: [{ product, suggestion: { variantId, variantName, quantity, unitPricePaise, pricePerKgPaise }, totalPaise, reason, add }] } }`. |
| `POST /stores/:slug/assistant` | Public; personal when signed in. `{ message }` → `{ reply: { kind: answer\|results\|proposal\|sign_in, intent, answer, … } }` — hours, delivery and minimum, offers, "my usual", a whole list (→ basket proposal), comparisons, search. It never adds to the cart. |
| `GET /stores/:slug/products/:productId/recommendations` | Public. `{ recommendations: { items: [{ product, reason }], rule } }` — bought together in at least two completed orders here (180 days), then popular in the same category. |
| `GET /stores/:slug/products/:productId/alternatives` | Public. `{ alternatives: { items: [{ product, reason, score }] } }` — similar name or category, buyable, within half to one-and-a-half times the price. |
| `POST /stores/:storeId/basket/propose` | Bearer, customer. `{ text }` ("2 kg rice, 1 litre oil and 6 eggs") → `{ basket: { proposals: [{ text, product, suggestion, linePaise, reason, alternatives, add }], unmatched, estimatePaise } }`. Uses the customer's usual size when none is written. Nothing is added. |
| `GET /me/replenishment` | Bearer, customer. `{ replenishment: { items: [{ product, everyDays, lastBoughtOn, dueOn, dueInDays, status: due\|soon\|later, usualQuantity, usualVariantId }], rule } }`. |
| `GET /me/discover` | Bearer, customer. `?storeId=` → `{ discover: { basedOn, items: [{ product, reason }], offers } }` — new-to-you products from the categories you buy here. |


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
