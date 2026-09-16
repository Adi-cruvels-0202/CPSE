-- 0006_products.sql — the sellable items. Checklist 1.4.
-- price_paise is the live price. It is snapshotted onto order_items at order
-- time (decision D11) so editing it later never rewrites order history.

create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores (id) on delete cascade,
  category_id   uuid references public.categories (id) on delete set null,
  name          text not null,
  slug          citext not null,
  description   text,

  price_paise   integer not null,
  -- Printed/list price, shown struck through when higher than price_paise.
  mrp_paise     integer,

  is_available  boolean not null default true,
  -- null = the store does not track stock for this product (unlimited).
  stock         integer,

  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint products_name_len      check (char_length(name) between 1 and 200),
  constraint products_slug_format   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint products_price_nonneg  check (price_paise >= 0),
  constraint products_mrp_nonneg    check (mrp_paise is null or mrp_paise >= 0),
  -- A "discount" that raises the price would be a display bug, not a deal.
  constraint products_mrp_gte_price check (mrp_paise is null or mrp_paise >= price_paise),
  constraint products_stock_nonneg  check (stock is null or stock >= 0)
);

create index if not exists products_store_id_idx    on public.products (store_id);
create index if not exists products_category_id_idx on public.products (category_id);
create unique index if not exists products_store_slug_key on public.products (store_id, slug);
-- Covers the storefront's default listing: available products of one store.
create index if not exists products_store_available_idx
  on public.products (store_id, sort_order, name) where is_available;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();
