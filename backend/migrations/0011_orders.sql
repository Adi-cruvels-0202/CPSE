-- 0011_orders.sql — Checklist 1.9.
-- Every money field is integer paise (D8) and every human-readable field a
-- customer sees later is a snapshot taken at order time (D11), so a merchant
-- editing a product or a customer deleting an address never rewrites history.

create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  order_number      text not null default public.generate_order_number(),
  store_id          uuid not null references public.stores (id) on delete restrict,
  customer_id       uuid not null references public.customers (id) on delete restrict,

  fulfilment_mode   fulfilment_mode not null,
  status            order_status not null default 'placed',
  payment_status    payment_status not null default 'pending',

  -- Address snapshot. address_id keeps the link for convenience but may become
  -- null if the customer deletes the address; the JSON copy is what we render.
  address_id        uuid references public.addresses (id) on delete set null,
  delivery_address  jsonb,

  -- Store contact snapshot, so a pickup order still shows where to go.
  store_snapshot    jsonb,

  -- Money breakdown. total = subtotal - discount + delivery_fee + tax.
  subtotal_paise     integer not null,
  discount_paise     integer not null default 0,
  delivery_fee_paise integer not null default 0,
  tax_paise          integer not null default 0,
  total_paise        integer not null,

  customer_note     text,
  cancellation_reason text,

  -- Duplicate-submission guard (decision D10). Supplied by the client as an
  -- Idempotency-Key header; unique per customer, not globally.
  idempotency_key   text,

  placed_at         timestamptz not null default now(),
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint orders_subtotal_nonneg  check (subtotal_paise >= 0),
  constraint orders_discount_nonneg  check (discount_paise >= 0),
  constraint orders_delivery_nonneg  check (delivery_fee_paise >= 0),
  constraint orders_tax_nonneg       check (tax_paise >= 0),
  constraint orders_total_nonneg     check (total_paise >= 0),
  -- The breakdown must actually add up; a mismatch is a pricing-engine bug and
  -- should fail loudly at write time rather than confuse a customer later.
  constraint orders_total_adds_up check (
    total_paise = subtotal_paise - discount_paise + delivery_fee_paise + tax_paise
  ),
  constraint orders_discount_lte_subtotal check (discount_paise <= subtotal_paise),
  -- A delivery order without an address snapshot is unfulfillable.
  constraint orders_delivery_needs_address check (
    fulfilment_mode <> 'delivery' or delivery_address is not null
  ),
  constraint orders_note_len check (customer_note is null or char_length(customer_note) <= 500)
);

-- Checklist 1.17
create unique index if not exists orders_order_number_key on public.orders (order_number);
create index if not exists orders_store_id_idx    on public.orders (store_id);
create index if not exists orders_customer_id_idx on public.orders (customer_id);
create index if not exists orders_address_id_idx  on public.orders (address_id);
-- The order-history screen: newest first for one customer.
create index if not exists orders_customer_placed_idx on public.orders (customer_id, placed_at desc);
create index if not exists orders_status_idx on public.orders (status);
create unique index if not exists orders_customer_idempotency_key
  on public.orders (customer_id, idempotency_key) where idempotency_key is not null;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();
