# Merchant API — v1 (contract)

> **Status: CONTRACT — agreed before code.** Written Day 1 (WORK_PLAN §5) for Mohit to review.
> Nothing here is implemented yet. As each module is built, its section **moves into
> `docs/API.md`**, where `tests/apiDocs.test.js` then holds it to the router. Until then this file
> is the agreement both sides build against: Aditya implements it, Mohit's screens mock it.
>
> Changing anything here after approval = a PR to this file, reviewed by the other person.

Base path: **`/api/v1`**. Every merchant path below is under **`/merchant`**, and every
store-scoped one under **`/merchant/stores/:storeId`**.

- [Conventions](#conventions)
- [Roles and ownership](#roles-and-ownership)
- [Errors added by this API](#errors-added-by-this-api)
- [P0 endpoints](#p0-endpoints)
  - [Merchant account](#merchant-account)
  - [Stores](#stores)
  - [Categories](#categories)
  - [Products and variants](#products-and-variants)
  - [Inventory](#inventory)
  - [Orders](#orders)
- [How stock moves (D-5)](#how-stock-moves-d-5)
- [How tax is computed (D-4)](#how-tax-is-computed-d-4)
- [What changes on the customer API](#what-changes-on-the-customer-api)
- [P1 endpoints — draft](#p1-endpoints--draft)
- [Questions for Mohit's review](#questions-for-mohits-review)

---

## Conventions

Everything in `docs/API.md` → *Conventions* applies unchanged. The ones that differ from
Merchant-One:

| | Merchant-One | Here |
|---|---|---|
| Money | `50.00` (rupees, decimal) | `5000` in a field ending **`Paise`** (integer) |
| Success | `{ success, message, data }` | `{ success: true, data: { <named key> }, meta? }` — `data` is never a bare array |
| Failure | `{ success, message }` | `{ success: false, error: { code, message, details? }, requestId }` — switch on `code`, show `message` |
| Pagination | `?page=0&size=20` (0-based) | `?page=1&limit=20` (**1-based**), `limit` ≤ 100; `meta: { page, limit, total, totalPages, hasNextPage }` |
| Enums | `UPPER_CASE` | `lower_case` (`placed`, `stock_in`, `grocery`) |
| Updates | `PUT` with the whole object | `PATCH` with only the changed fields; `PUT` only where the body *is* the whole thing (hours, delivery, payments) |
| Actions | `PATCH /…/accept` | `POST /…/accept` — same as the customer API (`POST /orders/:id/cancel`) |
| Unknown fields | ignored | **422** — every schema is strict |

Pickers that loaded 200–500 products at once (POS, purchases) should use `?search=` with
`limit ≤ 100` instead.

---

## Roles and ownership

- **One login for everyone** (Supabase Auth, D-2). A merchant is an auth user with a row in
  `merchants`. The same person can also be a customer.
- A signed-in user who is **not a merchant** calling any `/merchant/*` route → **403
  `MERCHANT_REQUIRED`**. This is a role check, not an ownership check, so 403 is correct here.
- A `storeId` that does not exist **or belongs to another merchant** → **404 `NOT_FOUND`**. Same
  rule as the customer API: never confirm that someone else's store exists. The same holds for
  every category, product, variant and order id under a store.
- No token / expired token → **401 `UNAUTHORIZED`**, as everywhere.

---

## Errors added by this API

| Status | Code | When |
|---|---|---|
| 403 | `MERCHANT_REQUIRED` | Signed in, but the account is not a merchant |
| 409 | `SLUG_TAKEN` | Store slug already used by another store |
| 409 | `CATEGORY_NAME_TAKEN` | A category with that name already exists in this store |
| 409 | `SKU_TAKEN` | SKU already used in this store |
| 409 | `CONFLICT` | Illegal order transition, publishing a published store, editing a slug after publishing |
| 422 | `STORE_INCOMPLETE` | Publish refused. `details.missing[]` lists what is needed: `address`, `phone`, `openingHours`, `fulfilment` |
| 422 | `INSUFFICIENT_STOCK` | A stock-out (or POS sale) larger than **available** stock. `details: { availableQuantity }` |
| 422 | `BELOW_RESERVED` | An adjustment that would put on-hand below what is reserved for open orders. `details: { reservedQuantity }` |
| 422 | `NOT_TRACKED` | A stock movement on a product with `trackInventory: false` |

Everything in `docs/API.md` → *Errors* also applies.

---

## P0 endpoints

### Merchant account

> ✅ **Built** (`backend/merchant-auth`). The authoritative description is now
> `docs/API.md` → *Merchant account*; the table below is kept as the agreed original.

Login, refresh, logout, forgot and reset password are the **existing** `/auth/*` endpoints.

| | |
|---|---|
| `POST /merchant/auth/register` | **public.** `{ email, password, fullName, phone? }` → **201** `{ merchant, session, emailConfirmationRequired }`. Same rules as customer register: duplicate email **409**, same wording whether or not it exists elsewhere. |
| `POST /merchant/onboard` | Bearer. `{ fullName?, phone? }` → **201** `{ merchant }`. Turns an existing signed-in account into a merchant. Already a merchant → **200** with the same shape. |
| `GET /merchant/me` | Bearer. `{ merchant, stores: [{ id, name, slug, isPublished, logoUrl }] }`. The app calls this after login to pick the active store. **403 `MERCHANT_REQUIRED`** means "offer onboarding". |
| `PATCH /merchant/me` | Bearer. `{ fullName?, phone? }` → `{ merchant }`. |

`POST /auth/login` gains one **additive** field: `roles: ["customer"] | ["customer", "merchant"]`.
The customer app ignores it.

```json
"merchant": {
  "id": "7c1e…", "email": "owner@shop.in", "fullName": "Ravi Sharma",
  "phone": "+919876543210", "createdAt": "2026-10-01T09:00:00Z"
}
```

### Stores

> ✅ **Built** (`backend/merchant-stores`). The authoritative description is now
> `docs/API.md` → *Merchant stores*. Two details settled while building: a new
> store takes **cash only** until the merchant switches online on, and
> `hours.opensAt` is the store's local `HH:MM`, the same as on the customer
> store page.

| | |
|---|---|
| `GET /merchant/stores` | `{ stores }` — the caller's stores, newest first. |
| `POST /merchant/stores` | `{ name, slug?, description?, shopCategory?, phone?, email?, address?, latitude?, longitude?, timezone? }` → **201** `{ store }`. Created **unpublished**, pickup on, delivery off, no hours. `slug` defaults to one made from the name. |
| `GET /merchant/stores/:storeId` | `{ store }` |
| `PATCH /merchant/stores/:storeId` | Any subset of the create fields. `slug` can change **only while unpublished** — after that it is in shared links and QR codes, so a change is **409**. |
| `POST /merchant/stores/:storeId/publish` | No body. Makes the store visible to customers. **422 `STORE_INCOMPLETE`** if anything in `details.missing` is absent; already published → **409**. |
| `POST /merchant/stores/:storeId/unpublish` | No body. Customers get **404** on the store page again; existing orders are unaffected. |
| `PUT /merchant/stores/:storeId/hours` | `{ timezone, openingHours }` → `{ store }`. Replaces the whole week. |
| `PUT /merchant/stores/:storeId/delivery` | `{ pickupEnabled, deliveryEnabled, deliveryFeePaise, minOrderPaise, freeDeliveryThresholdPaise?, deliveryRadiusKm? }` → `{ store }`. At least one of pickup/delivery must be on (422). |
| `PUT /merchant/stores/:storeId/payments` | `{ cash, online }` (booleans, at least one true) → `{ store }`. |

**`openingHours`** — all seven keys required; each is a list of windows (up to 3), 24-hour
`HH:MM`. An empty list is a closed day. A window whose `close` is earlier than `open` runs past
midnight. `timezone` is an IANA zone, default `Asia/Kolkata`. This is the format the customer
side already computes open/closed from (D-8), so the hours editor produces it directly.

```json
"openingHours": {
  "mon": [{ "open": "09:00", "close": "13:00" }, { "open": "16:00", "close": "21:30" }],
  "tue": [{ "open": "09:00", "close": "21:30" }],
  "wed": [], "thu": [{ "open": "09:00", "close": "21:30" }],
  "fri": [{ "open": "09:00", "close": "21:30" }], "sat": [{ "open": "09:00", "close": "23:00" }],
  "sun": [{ "open": "18:00", "close": "01:00" }]
}
```

**Payment methods.** The customer checkout takes `cash` or `online` (online = UPI, card or net
banking through the payment provider). Merchant-One's four methods collapse to these two
switches; UPI vs card is the provider's concern, not the store's.

**`store`** (merchant view — includes fields customers never see):

```json
"store": {
  "id": "3f2a…", "slug": "sharma-kirana", "name": "Sharma Kirana",
  "description": "Groceries and daily needs", "shopCategory": "grocery",
  "phone": "+919876543210", "email": "sharma@shop.in",
  "address": { "line1": "12 MG Road", "line2": null, "city": "Pune", "state": "MH", "postalCode": "411001", "country": "IN" },
  "latitude": 18.5204, "longitude": 73.8567,
  "logoUrl": null, "coverImageUrl": null,
  "timezone": "Asia/Kolkata", "openingHours": { "mon": [] },
  "hours": { "isOpen": false, "opensAt": "2026-10-02T09:00:00+05:30" },
  "fulfilment": {
    "pickupEnabled": true, "deliveryEnabled": true,
    "deliveryFeePaise": 3000, "minOrderPaise": 19900,
    "freeDeliveryThresholdPaise": 99900, "deliveryRadiusKm": 5
  },
  "paymentMethods": { "cash": true, "online": true },
  "isPublished": true,
  "publicPath": "/store/sharma-kirana",
  "createdAt": "2026-10-01T09:00:00Z", "updatedAt": "2026-10-01T09:30:00Z"
}
```

`shopCategory`: `grocery`, `pharmacy`, `restaurant`, `bakery`, `electronics`, `clothing`,
`general`, `other`. `publicPath` is what the "share / QR code" button links to.

### Categories

> ✅ **Built** (`backend/merchant-catalogue`), with Products and variants below. The
> authoritative description is now `docs/API.md` → *Merchant catalogue*. Settled
> while building: category responses carry their `slug`; a product response also
> has a top-level `isLowStock`; and the product list's `meta` is the standard
> pagination block.

| | |
|---|---|
| `GET /merchant/stores/:storeId/categories` | `{ categories }` — **including inactive**, in sort order, each with `productCount`. |
| `POST /merchant/stores/:storeId/categories` | `{ name, description? }` → **201** `{ category }`. Name 1–100 chars, unique per store (**409 `CATEGORY_NAME_TAKEN`**). Added at the end of the order. |
| `PATCH /merchant/stores/:storeId/categories/:categoryId` | `{ name?, description? }` → `{ category }` |
| `POST /merchant/stores/:storeId/categories/:categoryId/activate` | No body. → `{ category }` |
| `POST /merchant/stores/:storeId/categories/:categoryId/deactivate` | No body. Hidden from customers; its products stay listed under "all". |

```json
"category": {
  "id": "c1…", "name": "Rice & Grains", "description": null,
  "isActive": true, "sortOrder": 2, "productCount": 14,
  "createdAt": "…", "updatedAt": "…"
}
```

There is no delete: a category removed while products point at it would silently uncategorise
them. Deactivate instead.

### Products and variants

Every product has **at least one variant** (D-6). A "simple" product is one variant, usually
named `Default`; the customer app hides the selector when there is only one. **Price, MRP, cost,
SKU and stock live on the variant.** Stock is never set here — it moves only through
[Inventory](#inventory), so every change is in the ledger.

| | |
|---|---|
| `GET /merchant/stores/:storeId/products` | `?search=&categoryId=&isActive=&lowStock=&page=&limit=` → `{ products }`. Inactive products included unless `isActive=true`. `lowStock=true` = any variant at or below the threshold. |
| `POST /merchant/stores/:storeId/products` | See body below → **201** `{ product }` |
| `GET /merchant/stores/:storeId/products/:productId` | `{ product }` |
| `PATCH /merchant/stores/:storeId/products/:productId` | `{ name?, description?, categoryId?, unit?, taxPercent?, trackInventory?, lowStockThreshold?, images? }` → `{ product }`. `categoryId: null` uncategorises. `images` replaces the list. |
| `POST /merchant/stores/:storeId/products/:productId/activate` | No body. |
| `DELETE /merchant/stores/:storeId/products/:productId` | No body → 204. Archives the product (see above). |
| `POST /merchant/stores/:storeId/products/:productId/deactivate` | No body. Customers still see it, marked unavailable (it stays in order history and reorder). |
| `POST /merchant/stores/:storeId/products/:productId/variants` | One variant object (below) → **201** `{ product }` |
| `PATCH /merchant/stores/:storeId/products/:productId/variants/:variantId` | `{ name?, sku?, barcode?, weightGrams?, pricePaise?, mrpPaise?, costPaise? }` → `{ product }` |
| `POST /merchant/stores/:storeId/products/:productId/variants/:variantId/activate` | No body. |
| `POST /merchant/stores/:storeId/products/:productId/variants/:variantId/deactivate` | No body. |

**Create body**

```json
{
  "name": "India Gate Basmati Rice",
  "description": "Aged basmati",
  "categoryId": "c1…",
  "unit": "kg",
  "taxPercent": 5,
  "trackInventory": true,
  "lowStockThreshold": 5,
  "images": [{ "url": "https://…/rice.jpg", "altText": "Rice bag" }],
  "variants": [
    { "name": "1 kg", "sku": "RICE-1KG", "pricePaise": 12900, "mrpPaise": 14500, "costPaise": 10500, "openingQuantity": 40 },
    { "name": "5 kg", "pricePaise": 59900, "openingQuantity": 10 }
  ]
}
```

- `variants`: 1–50. `name` 1–120 chars, unique within the product. `sku` optional — generated if
  absent — and unique **per store** (**409 `SKU_TAKEN`**). `mrpPaise ≥ pricePaise`.
  `openingQuantity` writes a `stock_in` ledger row ("opening stock").
- `unit`: `pcs`, `kg`, `g`, `l`, `ml`, `m`, `cm`, `dozen`, `pack`, `box`, `pair`, `set`, `roll`,
  `plate`, `serving`. Default `pcs`.
- `taxPercent`: 0–100, up to 2 decimals. Default 0. See [tax](#how-tax-is-computed-d-4).
- `trackInventory: false` → stock is not counted, never runs out, and inventory endpoints refuse
  it (`NOT_TRACKED`).
- Delete archives (migration 0034): order lines and stock history keep the product id, but the
  product leaves every list, the storefront, the till and customers' carts, and answers 404.
- A price change is visible to customers at once: carts reprice on every read and flag
  `PRICE_CHANGED` (customer D25).

**`product`**

```json
"product": {
  "id": "p1…", "slug": "india-gate-basmati-rice", "name": "India Gate Basmati Rice",
  "description": "Aged basmati", "categoryId": "c1…", "categoryName": "Rice & Grains",
  "unit": "kg", "taxPercent": 5, "trackInventory": true, "lowStockThreshold": 5,
  "isActive": true,
  "pricePaise": 12900,
  "images": [{ "id": "i1…", "url": "https://…/rice.jpg", "altText": "Rice bag", "sortOrder": 0 }],
  "variants": [
    {
      "id": "v1…", "name": "1 kg", "sku": "RICE-1KG", "barcode": null, "weightGrams": 1000,
      "pricePaise": 12900, "mrpPaise": 14500, "costPaise": 10500,
      "isActive": true, "sortOrder": 0,
      "quantityOnHand": 40, "reservedQuantity": 3, "availableQuantity": 37, "isLowStock": false
    }
  ],
  "stock": { "quantityOnHand": 50, "reservedQuantity": 3, "availableQuantity": 47 },
  "createdAt": "…", "updatedAt": "…"
}
```

`pricePaise` on the product is the lowest active variant's price — what the customer's product
card shows. Stock fields are `null` when `trackInventory` is false.

### Inventory

> ✅ **Built** (`backend/merchant-inventory`). The authoritative description is now
> `docs/API.md` → *Merchant inventory*. Settled while building: a count to the
> number already on hand is a 422 rather than an empty ledger row, and history
> carries the standard pagination `meta`.

Stock is per variant. **On hand** is what is on the shelf; **reserved** is promised to open
orders; **available = on hand − reserved** is what can still be sold. The ledger is
**append-only**: a mistake is corrected by a new `adjustment`, never by editing a row.

| | |
|---|---|
| `POST /merchant/stores/:storeId/inventory/stock-in` | `{ variantId, quantity, unitCostPaise?, notes? }` → `{ variant, entry }`. `quantity` 1–100000. |
| `POST /merchant/stores/:storeId/inventory/stock-out` | `{ variantId, quantity, reason, notes? }` → `{ variant, entry }`. `reason`: `damaged`, `expired`, `lost`, `returned_to_supplier`, `own_use`, `other`. More than **available** → **422 `INSUFFICIENT_STOCK`**. |
| `POST /merchant/stores/:storeId/inventory/adjust` | `{ variantId, newQuantity, reason }` → `{ variant, entry }`. Sets on-hand after a physical count. `reason` is free text, required. Below reserved → **422 `BELOW_RESERVED`**. |
| `GET /merchant/stores/:storeId/inventory/history` | `?variantId=&productId=&movementType=&from=&to=&page=&limit=` → `{ entries }`, newest first. |

The stock screen itself lists products with `GET …/products` — every variant already carries
its three stock numbers — so there is no separate inventory list.

**`entry`**

```json
"entry": {
  "id": "l1…", "movementType": "order_reserved",
  "productId": "p1…", "productName": "India Gate Basmati Rice",
  "variantId": "v1…", "variantName": "1 kg", "sku": "RICE-1KG",
  "onHandChange": 0, "reservedChange": 2,
  "onHandAfter": 40, "reservedAfter": 3, "availableAfter": 37,
  "unitCostPaise": null, "reason": null, "notes": null,
  "reference": { "type": "order", "id": "o1…", "number": "ORD-24-000123" },
  "performedBy": { "type": "customer", "id": "u1…" },
  "createdAt": "…"
}
```

`movementType`: `stock_in`, `stock_out`, `adjustment`, `order_reserved`, `order_released`,
`order_fulfilled`; later `sale` (P1) and `purchase` (P2). `performedBy.type`: `merchant`,
`customer`, `system`.

### Orders

> ✅ **Built** (`backend/merchant-orders`). The authoritative description is now
> `docs/API.md` → *Merchant orders*. Settled while building: a disallowed action's
> 409 carries `details: { status, action }`; the order also carries `statusLabel`,
> `itemCount` and `acceptedAt` / `completedAt` / `cancelledAt`; and `status` can
> never take a pickup order out for delivery or a delivery order to the counter.

The order states and their rules are the customer side's (D-7, `order.state.js`). Every action
here goes through the same single writer (`transitionOrder`), so **the customer is notified of
every merchant action automatically**, and stock moves with it (see below).

| | |
|---|---|
| `GET /merchant/stores/:storeId/orders` | `?status=&fulfilmentMode=&from=&to=&page=&limit=` → `{ orders, counts }`, newest first. `status` takes a comma list (`placed,accepted`). `pending_payment` orders are left out unless asked for by name — nothing can be done with them yet. `counts` is per status, for tab badges. |
| `GET /merchant/stores/:storeId/orders/:orderId` | `{ order }` |
| `POST /merchant/stores/:storeId/orders/:orderId/accept` | No body. `placed → accepted`. |
| `POST /merchant/stores/:storeId/orders/:orderId/reject` | `{ reason? }` (≤ 300 chars). `placed` or `accepted` → `rejected`. Releases stock. |
| `POST /merchant/stores/:storeId/orders/:orderId/status` | `{ status }` — `preparing`, `ready_for_pickup` (pickup orders) or `out_for_delivery` (delivery orders). |
| `POST /merchant/stores/:storeId/orders/:orderId/complete` | No body. `ready_for_pickup` or `out_for_delivery` → `completed`. Deducts stock. |
| `POST /merchant/stores/:storeId/orders/:orderId/cancel` | `{ reason }` required (3–300 chars). From `accepted` onwards (a `placed` order is **rejected**, not cancelled). Releases stock. |

All actions answer `{ order }`. An illegal move → **409 `CONFLICT`**. An order in
`pending_payment` cannot be moved by the merchant at all — only a confirmed payment moves it.

**Use `allowedActions` to decide which buttons to show.** The server computes it from the state
machine and the fulfilment mode, so the screen never re-implements the rules.

```json
"order": {
  "id": "o1…", "orderNumber": "ORD-24-000123",
  "status": "accepted", "paymentStatus": "pending", "paymentMethod": "cash",
  "fulfilmentMode": "delivery",
  "allowedActions": ["status:preparing", "reject", "cancel"],
  "customer": { "id": "u1…", "name": "Jane Doe", "phone": "+919812345678" },
  "deliveryAddress": { "recipientName": "Jane Doe", "phone": "+919812345678", "line1": "…", "city": "Pune", "postalCode": "411001" },
  "customerNote": "Ring the bell twice",
  "cancellationReason": null,
  "items": [
    {
      "id": "oi1…", "productId": "p1…", "variantId": "v1…",
      "productName": "India Gate Basmati Rice", "variantName": "1 kg", "sku": "RICE-1KG",
      "quantity": 2, "unitPricePaise": 12900, "lineSubtotalPaise": 25800,
      "taxPercent": 5, "taxPaise": 1290, "lineTotalPaise": 27090
    }
  ],
  "totals": {
    "subtotalPaise": 25800, "discountPaise": 0, "deliveryFeePaise": 3000,
    "taxPaise": 1290, "totalPaise": 30090
  },
  "history": [
    { "status": "placed", "changedBy": "customer", "note": null, "at": "…" },
    { "status": "accepted", "changedBy": "store", "note": null, "at": "…" }
  ],
  "placedAt": "…", "updatedAt": "…"
}
```

`allowedActions` values: `accept`, `reject`, `cancel`, `complete`, `status:preparing`,
`status:ready_for_pickup`, `status:out_for_delivery`.

List rows are the same object without `items`, `history` and `deliveryAddress`, plus
`itemCount`.

---

## How stock moves (D-5)

| Event | On hand | Reserved | Ledger row |
|---|---|---|---|
| Customer places an order | — | **+qty** | `order_reserved` |
| Merchant rejects, merchant cancels, customer cancels, unpaid order expires | — | **−qty** | `order_released` |
| Merchant completes the order | **−qty** | **−qty** | `order_fulfilled` |
| Stock in | **+qty** | — | `stock_in` |
| Stock out | **−qty** | — | `stock_out` |
| Adjustment (count) | set to `newQuantity` | — | `adjustment` |
| POS sale (P1) | **−qty** | — | `sale` |

- A customer can only order what is **available**, so two customers cannot both buy the last unit.
- Note: online orders reserve at creation too (`pending_payment`), so the stock is held while the
  customer pays; if they never pay, the expiry sweep releases it.
- Products with `trackInventory: false` skip all of this.

## How tax is computed (D-4)

Tax is **added on top** of the price, per line, on items only — never on the delivery fee:

```
lineSubtotalPaise = unitPricePaise × quantity
taxPaise          = round_half_up(lineSubtotalPaise × taxPercent / 100)
lineTotalPaise    = lineSubtotalPaise + taxPaise
order taxPaise    = Σ line taxPaise
totalPaise        = subtotalPaise − discountPaise + deliveryFeePaise + taxPaise
```

The same function prices the customer's cart, the checkout quote, the order and a POS sale, so
the number on the merchant's screen is the number the customer was charged. `taxPercent` is
snapshotted onto each order line, so changing a product's rate never rewrites an old bill.

## What changes on the customer API

These land in `docs/API.md` with the code that causes them:

1. **Unpublished stores 404** on every customer endpoint, like inactive ones today.
2. **`taxPaise` is no longer always 0.** Cart, quote, order and receipt carry per-line
   `taxPercent` / `taxPaise`; invariant 2 in API.md ("prices are tax-inclusive") is replaced.
3. **`stock` on products and variants means *available*** (on hand − reserved).
4. `POST /auth/login` gains `roles`.
5. `POST /orders/:id/test-advance` is **removed** once merchant orders ship. ✅ Done, with
   `ENABLE_TEST_ENDPOINTS`.

---

## P1 endpoints — draft

> ✅ **Built** (`backend/p1`). The authoritative description is now `docs/API.md` →
> *Merchant photos, holidays, sales and dashboard*. Settled while building:
> holidays take `date` and answer only today's and later ones; a sale answers
> `{ sale, replayed }` like an order; the dashboard is under a `dashboard` key and
> its recent orders are summaries; upload refusals have their own codes.

Shapes to be confirmed on Day 5, and built on Day 6 only if P0 is merged (WORK_PLAN §1).

| | |
|---|---|
| `POST /merchant/stores/:storeId/logo` · `/cover` | multipart, field `file`; JPEG/PNG/WebP ≤ 5 MB → `{ store }`. Stored in Supabase Storage. |
| `POST /merchant/stores/:storeId/products/:productId/images` | multipart, field `file` → `{ product }`. `DELETE …/images/:imageId` → `{ product }`. |
| `GET`/`POST /merchant/stores/:storeId/holidays`, `DELETE …/holidays/:holidayId` | `{ date, reason? }`. The store shows closed that day. |
| `POST /merchant/stores/:storeId/sales` | **Send `Idempotency-Key`.** `{ items: [{ variantId, quantity }], paymentMethod: cash\|upi\|card\|other, customerName?, customerPhone?, discountPaise?, notes? }` → **201** `{ sale }`. Sells only available stock; same tax function. `GET …/sales`, `GET …/sales/:saleId`. |
| `GET /merchant/stores/:storeId/dashboard` | `{ today: { ordersCount, ordersRevenuePaise, salesCount, salesRevenuePaise }, openOrders: { placed, accepted, preparing, ready }, lowStock: [variant…], recentOrders: [order…] }` |

P2, not this week: purchases + batches + expiry, product duplicate, category reorder.

---

## Questions for Mohit's review

Answer in the PR; anything agreed is folded into this file before approval.

1. **Reject reason** is optional (as in Merchant-One) but **cancel reason** is required. Keep that?
2. **Publish requirements** — Merchant-One only required a name. This contract also asks for an
   address, a phone, at least one fulfilment mode and some opening hours, because the customer
   store page shows all of them. Too strict?
3. **Payment methods** collapse to `cash` / `online` for customer orders. POS still records
   `cash`, `upi`, `card`, `other`. OK?
4. **Stock-out reasons** — is the list complete for the shops you designed for?
5. **Anything a screen needs that is missing** from a response above?
