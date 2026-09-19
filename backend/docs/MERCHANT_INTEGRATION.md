# Merchant-side integration contract

The customer portal owns the customer journey: store page, browsing, cart,
addresses, checkout, orders, payments and order status. It does **not** own
stores, categories, products, inventory or any merchant tooling — those arrive
from the merchant side.

This document is the whole surface between the two. Nothing else is shared.

---

## 1. How the two sides meet today

Stores, categories, products, images and variants live in the **same Postgres
schema** (migrations `0004`–`0008`). The customer portal only ever **reads**
them; it has no endpoint that creates or edits a store, a product, a category,
an image or a variant, and it never will.

Two integration shapes are therefore possible, and the portal works unchanged
under either:

| Shape | What the merchant side does | What changes here |
|---|---|---|
| **Shared database** (assumed today) | Writes to `stores`, `categories`, `products`, `product_images`, `product_variants` | Nothing |
| **Separate service** | Exposes its own APIs and syncs into these tables | Only the sync job is new; the portal still reads the same tables |

Until the merchant side exists, `npm run db:seed` writes the dummy catalogue.

---

## 2. What the merchant side must guarantee

These are the invariants the customer portal relies on. Each one is enforced by
a constraint in the schema, so a violation fails at write time rather than
surfacing as a wrong price on a customer's bill.

### Money
- Every money value is **integer paise**. There are no decimals anywhere.
- `products.price_paise` is the live selling price.
- `product_variants.price_paise` is **absolute**, not a delta from the parent
  (decision D15). A 5 kg bag priced at ₹599 stores `59900`, not `+47000`.
- `mrp_paise`, when set, must be `>= price_paise`.

### Availability
The portal derives one flag, `isPurchasable`, from two columns, and gates
"Add to cart", the checkout quote and order creation on it:

| Columns | Meaning to the customer |
|---|---|
| `is_available = true`, `stock = null` | On sale, stock not tracked |
| `is_available = true`, `stock > 0` | On sale, `stock` units left |
| `is_available = true`, `stock = 0` | Sold out — shown, not purchasable |
| `is_available = false` | Withdrawn — shown, not purchasable |

Sold-out and withdrawn products are deliberately still listed (checklist 4.4).
Deleting a product removes it from the catalogue but never from order history,
because every order line is a snapshot (D11).

### Stock
- `stock = null` means untracked. The portal never decrements it.
- Otherwise the portal **decrements `stock`** inside the order transaction
  (`create_order`, migration 0020). The merchant side must treat `stock` as a
  shared counter, not as a value it can overwrite from a stale read.
- A variant's `stock` takes precedence over its parent's for that line.

### Store configuration
`stores` drives what checkout will accept:

| Column | Effect on the customer |
|---|---|
| `is_active = false` | The store 404s everywhere, including for existing carts |
| `pickup_enabled` / `delivery_enabled` | A fulfilment mode that is off is refused at quote time |
| `min_order_paise` | Checked against the **subtotal**, before the delivery fee |
| `delivery_fee_paise` | Added to delivery orders only |
| `opening_hours` + `timezone` | Open/closed is computed server-side (D21). A closed store warns but does not block (D29) |

`opening_hours` is a JSON object keyed by `mon`–`sun`, each an array of
`{ "open": "HH:MM", "close": "HH:MM" }` windows. An empty array is a closed
day; a window whose `close` is earlier than its `open` runs past midnight.
`timezone` must be an IANA zone — a CHECK rejects a typo at write time.

---

## 3. What the merchant side must NOT do

- **Do not write to** `carts`, `cart_items`, `addresses`, `order_items`,
  `order_status_history` or `payments`. They belong to the customer portal.
- **Do not edit an order's money columns.** `total = subtotal - discount +
  delivery_fee + tax` is a CHECK constraint (D17); an edit that breaks it is
  rejected, and one that does not still contradicts the receipt the customer
  already has.
- **Do not repurpose a product id.** Order lines keep the id for reorder; a
  recycled id silently reorders something else.

---

## 4. The one thing the merchant side must provide: order status

The customer portal reads order status; the merchant side writes it. This is
the only merchant→customer write in the contract.

**Allowed transitions** (`src/modules/orders/order.state.js` is the source of
truth, and `order_status_history` must gain a row for every move):

```
placed ──▶ accepted ──▶ preparing ──┬──▶ ready_for_pickup ──▶ completed
                                    └──▶ out_for_delivery ──▶ completed

pending_payment ──▶ placed | cancelled | rejected
placed / accepted ──▶ cancelled | rejected
preparing and later ──▶ cancelled
completed / cancelled / rejected ──▶ (terminal)
```

- `pending_payment` belongs to the payment flow. **The merchant side must never
  move an order out of it** — only a confirmed payment does that (checklist
  7.13).
- A customer may cancel from `pending_payment`, `placed` or `accepted` only.
  Later cancellations are the merchant's to make.
- `changed_by` on each history row is one of `customer`, `store`, `system`,
  `payment_webhook`. The merchant side writes `store`.

Until a merchant dashboard exists, `POST /api/v1/orders/:id/test-advance`
stands in for this (checklist 8.8). It is mounted only when
`ENABLE_TEST_ENDPOINTS=true`, and the app refuses to boot in production with
that flag set. **It is a test fixture, not the contract** — the contract is the
state machine above.

---

## 5. What the customer portal exposes back

If the merchant side prefers HTTP over shared tables, these are the reads it can
build on. All are public — a store page must open from a shared link with no
session (checklist 3.5).

| Endpoint | Returns |
|---|---|
| `GET /api/v1/stores/:slug` | Store page: info, hours, computed open/closed, fulfilment and payment options |
| `GET /api/v1/stores/:slug/categories` | Active categories, ordered |
| `GET /api/v1/stores/:slug/products` | Paginated listing, filterable by `categoryId` |
| `GET /api/v1/stores/:slug/products/:productId` | Detail with images and variants |
| `GET /api/v1/stores/:slug/search?q=` | Store-scoped search over name and description |

Everything else — cart, addresses, checkout, orders, payments — requires the
customer's own bearer token and is scoped to them.

---

## 6. Open points to agree with the merchant team

1. **Shared tables or a sync?** The portal reads the tables today. If the
   merchant side becomes a separate service, who owns the sync, and how stale
   may `stock` be?
2. **Stock authority.** The portal decrements on order. Does the merchant side
   accept that, or does it want to own the counter and expose a reservation
   call instead?
3. **Order notification.** How does the merchant side learn a new order exists
   — polling `orders`, a webhook from here, or Postgres LISTEN/NOTIFY?
4. **Rejection reasons.** `orders.cancellation_reason` is free text today. A
   shared enum would let the customer screen show a proper message.
5. **Discounts.** `orders.discount_paise` exists and the pricing engine carries
   it, but nothing sets it yet. Coupons, if any, are a merchant-side concept
   that would need a contract of its own.
