-- 0027_order_merchant_fields.sql — what the merchant side records on an order.
-- MERGE_MAPPING §4.3, MERCHANT_RULES §6–§7.
--
-- The tax columns default to 0, which is what every existing order charged, so
-- order_items_line_total_matches (line total = price × quantity) still holds.
-- The create_order change that starts charging tax also widens that check to
-- include the line's tax (MERCHANT_RULES O-16).

-- Merchant-One stamped these; CPSE already has completed_at and cancelled_at.
-- A reject reason is stored in cancellation_reason, which the contract returns
-- for both.
alter table public.orders
  add column if not exists accepted_at timestamptz;
alter table public.orders
  add column if not exists rejected_at timestamptz;

-- The merchant's order list: one store, filtered by status, newest first.
create index if not exists orders_store_status_placed_idx
  on public.orders (store_id, status, placed_at desc);

-- Snapshot at order time, like every other order_items field (D11): changing a
-- product's rate later never rewrites an old bill (D-4).
alter table public.order_items
  add column if not exists sku text;
alter table public.order_items
  add column if not exists tax_percent numeric(5, 2) not null default 0;
alter table public.order_items
  add column if not exists tax_paise integer not null default 0;

do $$ begin
  alter table public.order_items
    add constraint order_items_tax_percent_range check (tax_percent between 0 and 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.order_items
    add constraint order_items_tax_nonneg check (tax_paise >= 0);
exception when duplicate_object then null; end $$;
