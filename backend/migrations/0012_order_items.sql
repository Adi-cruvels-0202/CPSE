-- 0012_order_items.sql — Checklist 1.10.
-- The product/variant FKs are `on delete set null` and every displayed value is
-- copied here, so an order line survives the product being deleted (D11).

create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  product_id      uuid references public.products (id) on delete set null,
  variant_id      uuid references public.product_variants (id) on delete set null,

  -- Snapshot at order time
  product_name    text not null,
  variant_name    text,
  image_url       text,
  unit_price_paise integer not null,
  quantity        integer not null,
  line_total_paise integer not null,

  created_at      timestamptz not null default now(),

  constraint order_items_quantity_positive check (quantity > 0),
  constraint order_items_unit_price_nonneg check (unit_price_paise >= 0),
  constraint order_items_line_total_matches check (line_total_paise = unit_price_paise * quantity)
);

create index if not exists order_items_order_id_idx   on public.order_items (order_id);
create index if not exists order_items_product_id_idx on public.order_items (product_id);
create index if not exists order_items_variant_id_idx on public.order_items (variant_id);
