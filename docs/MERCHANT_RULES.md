# Merchant rules — ported from Merchant-One

> Every business rule in Merchant-One's Java backend (`com.shopflow.*`), in plain English, and what
> happens to it in CPSE. Written from the code, not from memory: each section names the file it
> came from. This is the source the backend PRs port from (WORK_PLAN §5, Day 1).
>
> Where a rule conflicts with an agreed decision (`docs/MERGE_MAPPING.md` §5) or with the contract
> (`backend/docs/MERCHANT_API.md`), the decision and the contract win; the row says so.

Each rule is marked:

- **Keep** — ported as is.
- **Changed** — ported, but differs because of a decision (D-n) or the contract.
- **Fix** — a defect in Merchant-One. CPSE does it correctly; the row says what was wrong.
- **Later** — P1/P2, not this week.

Money in Merchant-One is `DECIMAL` rupees; in CPSE everything is integer paise (D-3). The rules
below are written in paise.

---

## 1. Accounts and roles — `user/AuthService`, `security/*`

| # | Rule in Merchant-One | CPSE |
|---|---|---|
| A-1 | Register: name 2–100 chars, valid email, password 8–100 chars. Email stored lower-cased and trimmed. Duplicate email → 409. | **Changed (D-2).** Supabase Auth owns credentials. Merchant register reuses the customer register rules and adds a `merchants` row. |
| A-2 | Every registered user is a `MERCHANT`. An `ADMIN` role exists but nothing uses it. | **Changed.** Role = "has a `merchants` row". No admin role this week. |
| A-3 | Login failure says "Invalid email or password" whether or not the email exists. | **Keep** — CPSE already does this. |
| A-4 | Access token 24 h, refresh 7 days, own JWT. | **Changed (D-2).** Supabase sessions. |
| A-5 | Every store-scoped call checks the store belongs to the caller (`verifyStoreOwnership`); otherwise 403 "You do not have access to this store". | **Changed.** `requireStoreOwner`, and a store that is not yours is **404**, not 403 — never confirm someone else's store exists (contract, *Roles and ownership*). Same for every child id. |

## 2. Stores — `store/StoreService`, `store/dto/*`

| # | Rule in Merchant-One | CPSE |
|---|---|---|
| S-1 | A merchant may own **several** stores. | **Keep.** |
| S-2 | Name 2–100 chars (required); description ≤ 1000; address ≤ 500; phone matches `^[+]?[0-9]{7,15}$` or is empty; email valid. | **Keep** the limits. Address becomes CPSE's structured form (MERGE_MAPPING §4.1). |
| S-3 | `shopCategory` one of `GROCERY, PHARMACY, RESTAURANT, BAKERY, ELECTRONICS, CLOTHING, GENERAL, OTHER`. | **Keep**, lower-case in the API. |
| S-4 | Slug made from the name (lower-case, slugified; blank → `store`). If taken, append `-2`, `-3`, … until free. | **Keep** the generation. |
| S-5 | The slug **never** changes after creation, even when the name changes ("URL stability"). | **Changed.** The slug may change **while unpublished**; after publishing a change is 409 (contract). Same intent — links in the wild never break. |
| S-6 | A new store is created **unpublished**. | **Keep.** |
| S-7 | On create: default hours Mon–Sat 09:00–21:00, Sunday closed; delivery settings created disabled; payment preferences created with **only CASH enabled**. | **Changed.** Contract: pickup on, delivery off, **no hours** (publish then requires them). Payments start as `cash: true, online: false`, matching Mohit's "cash only" default. |
| S-8 | Publish requires only a non-blank name. Publishing a published store → error; unpublishing an unpublished one → error. | **Changed.** Publish also needs address, phone, opening hours and at least one fulfilment mode (`STORE_INCOMPLETE`, contract question 2). Already published → 409; unpublish when unpublished → 409. |
| S-9 | Unpublished stores are invisible on the storefront (lookups use `isPublished = true`). | **Keep** — and customer endpoints return 404 for them, as for inactive stores today. |

### Opening hours and holidays

| # | Rule in Merchant-One | CPSE |
|---|---|---|
| S-10 | Hours are saved as a whole week (delete all, insert all). | **Keep** — `PUT …/hours` replaces the week. |
| S-11 | One window per day. Closing must be **after** opening, so a day cannot run past midnight. | **Changed (D-8).** Up to 3 windows a day; `close < open` means past midnight. |
| S-12 | Holidays: a date (required) and an optional reason. Deleting checks the holiday belongs to the store. | **Later (P1).** Open/closed must treat a holiday as closed — Merchant-One stored holidays but **nothing read them**, so the storefront never showed a store closed on a holiday. |

### Delivery and payment

| # | Rule in Merchant-One | CPSE |
|---|---|---|
| S-13 | Delivery settings: enabled flag, radius, fee, minimum order, free-delivery threshold — all ≥ 0 when set. | **Keep**, in paise and km. |
| S-14 | **Fix.** The delivery fee, minimum order and free-delivery threshold were **never applied** to an order: the order total was subtotal + tax only. | CPSE's checkout quote already applies fee and minimum; the free-delivery threshold is added to it (fee = 0 when subtotal ≥ threshold). |
| S-15 | **Fix.** A delivery order was accepted even when delivery was disabled — only pickup was checked. | Both modes are checked at checkout (CPSE already refuses a disabled mode). At least one mode must stay on (contract, 422). |
| S-16 | Payment methods `CASH, UPI, CARD, NET_BANKING`, each on/off per store. | **Changed.** Online orders: `cash` / `online` switches (contract question 3). POS keeps `cash, upi, card, other`. |

### Images

| # | Rule in Merchant-One | CPSE |
|---|---|---|
| S-17 | Logo, cover and product images: JPEG/PNG/WebP only, ≤ 5 MB, extension must be `.jpg/.jpeg/.png/.webp`, saved under a random UUID file name. | **Later (P1)**, same limits, Supabase Storage (D-10). P0 takes image **URLs**. |
| S-18 | **Fix.** Deleting a product image checked the product was yours but not that the image belonged to that product, so any image id could be deleted. | Look the image up **by product id and image id together**. |

## 3. Categories — `category/CategoryService`

| # | Rule in Merchant-One | CPSE |
|---|---|---|
| C-1 | Name 1–100 chars, trimmed; description ≤ 500. | **Keep.** |
| C-2 | Name unique within a store → 409. | **Keep** (`CATEGORY_NAME_TAKEN`), but **case-insensitive** — Merchant-One allowed "Dairy" and "dairy" side by side. |
| C-3 | A new category goes to the end of the display order (max + 1). | **Keep.** |
| C-4 | Deactivating a category keeps its products assigned. | **Keep.** Category hidden from customers; its products still show under "all" (contract). |
| C-5 | No delete — only activate / deactivate. | **Keep.** |
| C-6 | Reorder: a list of ids sets display order 0, 1, 2 … | **Later (P2).** |

## 4. Products and variants — `product/ProductService`, `product/ProductVariant`

| # | Rule in Merchant-One | CPSE |
|---|---|---|
| P-1 | Name 1–200 chars, trimmed; description ≤ 2000; price ≥ 0; MRP ≥ 0; cost ≥ 0; tax 0–100 %. | **Keep.** Plus `mrpPaise ≥ pricePaise` (contract). |
| P-2 | Category, if given, must belong to the same store; otherwise 404. | **Keep.** |
| P-3 | Units: `PCS, KG, G, L, ML, M, CM, DOZEN, PACK, BOX, PAIR, SET, ROLL, PLATE, SERVING`; default `PCS`. | **Keep**, lower-case. |
| P-4 | Every product has at least one variant. A product without variants gets one called "Default" with the product's price and cost. | **Keep (D-6).** Existing CPSE products get a default variant in the backfill migration. |
| P-5 | SKU optional; generated as `SKU-<first 8 letters/digits of the name, upper-case>-<6 random hex>`. Duplicate SKU → 409. | **Keep** the generation. **Changed:** unique **per store** (`SKU_TAKEN`), not across the whole system — two shops may both use `MILK-500`. |
| P-6 | `trackInventory` defaults to true. | **Keep.** When false: no stock counted, never sold out, inventory endpoints refuse it (`NOT_TRACKED`). |
| P-7 | Low stock = on-hand ≤ the product's `lowStockThreshold`. | **Changed:** compare **available** (on hand − reserved), which is what can actually still be sold. |
| P-8 | No delete — only activate / deactivate, for products and variants. | **Revised** (migration 0034): a product can be deleted, which archives it — it leaves every list, the store and the till, while order lines and stock history keep its id. Variants: still activate / deactivate only. |
| P-9 | Inactive products / variants cannot be ordered. | **Keep.** |
| P-10 | **Fix.** Editing a product's price changed `products.price` but **not** the default variant's price — and orders charge the variant price, so the edit did nothing at checkout. | Price lives on the variant only. The product's `pricePaise` is derived (lowest active variant). |
| P-11 | Customers never see cost price, reserved quantity, low-stock threshold or track-inventory (`toPublicDto`). Public stock = **available**. | **Keep.** Cost is merchant-only; customer `stock` means available (contract, customer change 3). |
| P-12 | Duplicate a product: copy named "<name> (Copy)", **inactive**, new SKUs, no barcode, no stock. | **Later (P2).** |

## 5. Inventory — `inventory/InventoryService`

Merchant-One kept two numbers per variant: **on hand** and **reserved**. **Available = on hand −
reserved.** The variant has a `version` column for optimistic locking (`@Version`), so two writers
cannot both update from the same old number. CPSE keeps the number pair and the `version` column,
and also keeps its row locks inside `create_order`.

| # | Rule in Merchant-One | CPSE |
|---|---|---|
| I-1 | Stock in: quantity ≥ 1, optional unit cost, notes. On hand += qty. Writes a ledger row. | **Keep.** Contract caps at 100 000. |
| I-2 | Stock out: quantity ≥ 1. Refused if more than **on hand**. On hand −= qty. Writes a ledger row. | **Fix.** Refuse if more than **available** (`INSUFFICIENT_STOCK`). Checking on hand let a stock-out eat units already promised to customers. Also needs a `reason` (contract). |
| I-3 | Adjust: set on hand to `newQuantity` ≥ 0 after a physical count. Ledger row stores the difference. | **Fix.** Refuse a count below **reserved** (`BELOW_RESERVED`) — Merchant-One allowed it, leaving available negative. `reason` required. |
| I-4 | The variant must belong to the store, otherwise refused. | **Keep** (404). |
| I-5 | Every on-hand change writes a ledger row: type, signed quantity, before, after, unit cost, reference type + id, notes, who did it. | **Keep**, and extended: the row also records reserved before/after. |
| I-6 | **Fix.** Reserving and releasing wrote **no ledger row**, so reserved stock changed with no trace. | `order_reserved` and `order_released` rows (contract). |
| I-7 | **Fix.** Releasing more than was reserved was silently clamped to 0 (`Math.max(0, …)`), hiding the bug that caused it. | Release exactly what the order reserved; anything else is an error, not a clamp. |
| I-8 | **Fix.** Completing an order deducted on hand without checking it — only the database `CHECK (quantity_on_hand >= 0)` stopped it going negative. | Reserved stock is always ≤ on hand (I-2, I-3), so completion cannot underflow; the CHECK stays as the last line. |
| I-9 | **Fix.** Manual stock in / out / adjust ignored `trackInventory`. | `NOT_TRACKED` (P-6). |
| I-10 | History: newest first, paged (default 20), optional filter by movement type. | **Keep**, plus filters by variant, product and date range (contract). |
| I-11 | Movement types: `STOCK_IN, STOCK_OUT, ADJUSTMENT, SALE, SALE_RETURN, PURCHASE, PURCHASE_RETURN, TRANSFER, DAMAGE, EXPIRY`. Stock-out and adjust could pass any type. | **Changed.** `stock_in, stock_out, adjustment, order_reserved, order_released, order_fulfilled`, later `sale`, `purchase`. Damage/expiry become stock-out **reasons**, not types. |

## 6. Orders — `order/OrderService`, `order/OrderStatus`

### States

Merchant-One: `PENDING → ACCEPTED → PREPARING → READY → COMPLETED`, with `REJECTED` and
`CANCELLED` as exits. CPSE keeps its own 9 states (D-7, mapping in MERGE_MAPPING §4.4).

| # | Rule in Merchant-One | CPSE |
|---|---|---|
| O-1 | `PENDING` → accepted, rejected or cancelled. | **Changed.** `placed` → `accepted` or `rejected`. A `placed` order is rejected, not cancelled (contract). |
| O-2 | `ACCEPTED` → preparing or cancelled. **Reject only from pending.** | **Changed.** `accepted` may also be **rejected** (contract). |
| O-3 | `PREPARING` → ready or cancelled. `READY` → completed or cancelled. | **Keep.** Ready splits into `ready_for_pickup` / `out_for_delivery` by fulfilment mode. |
| O-4 | Completed, rejected and cancelled are final — no transition out. | **Keep.** |
| O-5 | The generic "set status" call may only move to preparing / ready. Accept, reject, complete and cancel have their own calls. | **Keep.** |
| O-6 | Any illegal move → error naming the order and both states. | **Keep** (409 `CONFLICT`). |
| O-7 | Each move stamps a time: accepted, rejected, completed, cancelled. | **Keep** (`accepted_at`, `rejected_at` added), and CPSE also writes `order_status_history`. |
| O-8 | Reject reason optional → stored in merchant notes. Cancel reason **required**. | **Keep** (contract question 1). Reject ≤ 300 chars; cancel 3–300. |
| O-9 | — (Merchant-One had no `pending_payment`.) | A `pending_payment` order cannot be moved by the merchant. |
| O-10 | Every merchant order call is store-scoped and ownership-checked. | **Keep** (404 for someone else's order). |
| O-11 | List newest first, optional status filter, paged (default 20). | **Keep**, plus comma-separated statuses, fulfilment mode, dates and per-status counts. |

### Stock through an order

| Event | Merchant-One | CPSE (D-5 = C) |
|---|---|---|
| Order placed | Checks available ≥ qty, **reserves nothing**. | **Reserves** in `create_order` (`order_reserved`). |
| Accepted | Reserves; fails if not available. | Nothing — already reserved. |
| Rejected | **Nothing** (nothing was reserved). | Releases (`order_released`). |
| Cancelled | Releases only if it was accepted / preparing / ready. | Releases (`order_released`) — from any state that holds a reservation, including customer cancel and unpaid expiry. |
| Completed | On hand −qty, reserved −qty, ledger `SALE`. | Same, ledger `order_fulfilled`. |

**Fix.** Because Merchant-One reserved only on accept, two customers could both order the last
unit; the second accept then failed and the merchant had to reject an order the customer had
already been told was placed. Reserving at placement means the second customer is told "out of
stock" at checkout instead.

### Prices and numbering

| # | Rule in Merchant-One | CPSE |
|---|---|---|
| O-12 | Unit price = the variant's price **at order time**; product name, variant name and SKU are copied onto the line. | **Keep** — CPSE snapshots these already, plus SKU. |
| O-13 | All items must belong to the store and be active. | **Keep.** |
| O-14 | Tax per line, see §7. Order tax = sum of line taxes. | **Keep (D-4).** |
| O-15 | Order total = subtotal + tax. No discount, no delivery fee. | **Changed.** `total = subtotal − discount + deliveryFee + tax`, the existing CHECK. |
| O-16 | **Fix.** Order line total **excluded** tax, while a POS sale's line total **included** it — the same word meant two things. | Line total = line subtotal + line tax, everywhere. |
| O-17 | Order number `ORD-000001`, per store, computed as current max + 1. | **Changed.** CPSE keeps its own numbering. **Fix:** max + 1 is a race — two orders at once get the same number and one fails on the unique constraint. |
| O-18 | **Fix.** Orders had an idempotency-key column but nothing read it, so a retried request placed a second order. | CPSE's `create_order` is already idempotent (`Idempotency-Key`). |
| O-19 | Customer name and phone are required on the order; email optional. | **Changed.** The customer is a signed-in `customers` row. Walk-in buyers go through POS `sales`, not `orders`. |

## 7. Tax — `OrderService.createOrder`, `SalesService.createSale`

Ported exactly (D-4 = B, added on top, items only):

```
lineSubtotal = unitPrice × quantity
lineTax      = round_half_up(lineSubtotal × taxPercent / 100)     # to the paisa
taxPercent   = the product's tax_percent, or 0 when unset
```

- Tax is per **line**, rounded per line, then summed — not computed on the order total.
  Rounding per line vs. on the total can differ by a paisa; per line is what Merchant-One did and
  what an itemised bill shows.
- Tax is never applied to the delivery fee.
- `taxPercent` is copied onto the order line, so changing the product's rate later never changes
  an old bill.
- Tax is on the **product**, not the variant: all sizes of one product share a rate.

## 8. POS / direct sales — `sales/SalesService` (P1)

| # | Rule in Merchant-One | CPSE |
|---|---|---|
| X-1 | At least one item, each quantity ≥ 1. Items must belong to the store. | **Keep.** |
| X-2 | Idempotency key: the same key returns the first sale instead of creating another. | **Keep.** |
| X-3 | Same per-line tax as orders. Optional discount on the whole sale. | **Keep.** |
| X-4 | Total = subtotal + tax − discount; a discount bigger than that is clamped to a total of 0. | **Changed:** a discount above subtotal + tax is refused (422) rather than silently turned into a free sale. |
| X-5 | Products with `trackInventory = false` are sold without touching stock. | **Keep.** |
| X-6 | Stock check is against **on hand**. | **Fix (D-5).** Against **available**, so a counter sale cannot take units reserved for an online order. |
| X-7 | Ledger row per line, type `SALE`, reference the sale. | **Keep** (`sale`). |
| X-8 | Invoice number `INV-000001`, global max + 1. | **Changed** — per store, generated without the max + 1 race (O-17). |
| X-9 | Customer name / phone optional, payment method optional. | **Keep**, payment method required (`cash, upi, card, other`). |
| X-10 | Concurrency: tests prove two simultaneous sales of the last unit cannot both succeed, and a failed ledger write rolls back the stock change. | **Keep** — the same two tests are ported. |

## 9. Dashboard — `dashboard/DashboardController` (P1)

| # | Rule in Merchant-One | CPSE |
|---|---|---|
| D-1 | Today's and this month's sales count and revenue; product count; low-stock count. | **Changed** to the contract's shape (orders **and** sales, open orders by state, low-stock list, recent orders). |
| D-2 | **Fix.** "Today" and "this month" started at midnight **UTC** — 05:30 in India, so the first 5½ hours of each day counted as yesterday. | Day boundaries in the store's timezone. |
| D-3 | **Fix.** Revenue counted POS sales only, not online orders. | Both. |
| D-4 | **Fix.** Low stock used a fixed threshold of 5 and ignored each product's own threshold. | The product's threshold, on available stock (P-7). |

## 10. Purchases and batches — `purchase/PurchaseService` (P2, not this week)

Recorded so the rules are not lost:

- A purchase has a supplier name/contact, a date (default today), notes and lines of variant,
  quantity, unit cost, optional batch number, manufacturing and expiry date.
- Purchase number `PO-000001`. Total = Σ unit cost × quantity.
- Each line is a stock-in with movement type `PURCHASE`, carrying the unit cost.
- A **batch** is recorded only when the line has a batch number. Remaining starts at the quantity.
- "Expiring soon" = expiry within **30 days**. Active batches = remaining > 0, earliest expiry first.
- **Gaps to close when this is built:** nothing ever set a batch as expired, and nothing reduced a
  batch's remaining quantity on a sale — so batches showed full stock forever and FIFO was not
  implemented.

---

## 11. Summary of fixes CPSE makes

The defects above, in one list, so each backend PR can have a test that would have caught it:

| Ref | Defect in Merchant-One | Covered in PR |
|---|---|---|
| O-fix | Last unit could be ordered twice (reserved only on accept) | `backend/order-tax-stock` |
| I-2 | Stock-out could take reserved units | `backend/merchant-inventory` |
| I-3 | Adjust could go below reserved | `backend/merchant-inventory` |
| I-6 | Reserve / release left no ledger trace | `backend/order-tax-stock` |
| I-7 | Over-release silently clamped to 0 | `backend/order-tax-stock` |
| I-9 | Manual movements ignored `trackInventory` | `backend/merchant-inventory` |
| P-10 | Price edit did not reach the variant | `backend/merchant-catalogue` |
| C-2 | Category names unique only case-sensitively | `backend/merchant-catalogue` |
| S-14 | Delivery fee / minimum never applied | `backend/order-tax-stock` (free-delivery threshold) |
| S-15 | Delivery order accepted with delivery off | already correct in CPSE — test kept |
| S-18 | Any product image could be deleted | P1 image upload |
| O-16 | "Line total" meant two different things | `backend/order-tax-stock` |
| O-17 / X-8 | max + 1 numbering race | `backend/merchant-orders`, P1 POS |
| O-18 | Order idempotency key never used | already correct in CPSE |
| X-4 | Over-sized discount silently gave a free sale | P1 POS |
| X-6 | POS could sell reserved units | P1 POS |
| D-2…D-4 | Dashboard in UTC, POS-only revenue, fixed low-stock threshold | P1 dashboard |
| S-12 | Holidays stored but never applied | P1 holidays |
