-- 0010_carts.sql — carts and their lines. Checklist 1.8.
-- One ACTIVE cart per customer per store: the spec's cart is store-scoped, so a
-- customer shopping at two stores keeps two carts.

create table if not exists public.carts (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  store_id    uuid not null references public.stores (id) on delete cascade,
  -- Set when the cart is converted to an order; the row is kept for history
  -- instead of being deleted.
  checked_out_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists carts_customer_id_idx on public.carts (customer_id);
create index if not exists carts_store_id_idx    on public.carts (store_id);
create unique index if not exists carts_one_active_per_customer_store
  on public.carts (customer_id, store_id) where checked_out_at is null;

drop trigger if exists carts_set_updated_at on public.carts;
create trigger carts_set_updated_at
  before update on public.carts
  for each row execute function public.set_updated_at();

create table if not exists public.cart_items (
  id          uuid primary key default gen_random_uuid(),
  cart_id     uuid not null references public.carts (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  variant_id  uuid references public.product_variants (id) on delete cascade,
  quantity    integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Prices are deliberately NOT stored here. A cart always shows the live
  -- price; the snapshot happens at order time (D11), and price drift between
  -- cart and checkout is surfaced to the customer (spec §6).
  constraint cart_items_quantity_positive check (quantity > 0),
  constraint cart_items_quantity_sane     check (quantity <= 999)
);

create index if not exists cart_items_cart_id_idx    on public.cart_items (cart_id);
create index if not exists cart_items_product_id_idx on public.cart_items (product_id);
create index if not exists cart_items_variant_id_idx on public.cart_items (variant_id);

-- Adding the same product+variant twice bumps the quantity instead of creating
-- a second line. coalesce lets the unique index treat "no variant" as a value.
create unique index if not exists cart_items_unique_line
  on public.cart_items (cart_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

drop trigger if exists cart_items_set_updated_at on public.cart_items;
create trigger cart_items_set_updated_at
  before update on public.cart_items
  for each row execute function public.set_updated_at();
