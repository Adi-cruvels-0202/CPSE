-- 0015_saved_stores.sql — "my stores" / favourites. Checklist 1.13.
-- Pure join table; the composite primary key makes saving twice a no-op.

create table if not exists public.saved_stores (
  customer_id uuid not null references public.customers (id) on delete cascade,
  store_id    uuid not null references public.stores (id) on delete cascade,
  created_at  timestamptz not null default now(),

  primary key (customer_id, store_id)
);

create index if not exists saved_stores_store_id_idx on public.saved_stores (store_id);
-- The list screen is "my saved stores, newest first".
create index if not exists saved_stores_customer_created_idx
  on public.saved_stores (customer_id, created_at desc);
