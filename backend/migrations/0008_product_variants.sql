-- 0008_product_variants.sql — Checklist 1.6.
-- A variant sets an ABSOLUTE price, not a delta. Deltas make a product's price
-- edit silently reprice every variant; absolute prices keep each line honest
-- and make the order-time snapshot (D11) a straight copy.

create table if not exists public.product_variants (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  name          text not null,
  price_paise   integer not null,
  -- null = not stock-tracked, same convention as products.stock
  stock         integer,
  is_available  boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint product_variants_name_len     check (char_length(name) between 1 and 120),
  constraint product_variants_price_nonneg check (price_paise >= 0),
  constraint product_variants_stock_nonneg check (stock is null or stock >= 0)
);

create index if not exists product_variants_product_id_idx
  on public.product_variants (product_id, sort_order);
create unique index if not exists product_variants_product_name_key
  on public.product_variants (product_id, lower(name));

drop trigger if exists product_variants_set_updated_at on public.product_variants;
create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();
