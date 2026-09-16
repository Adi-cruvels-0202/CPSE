-- 0005_categories.sql — product categories, scoped to one store. Checklist 1.3.

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id) on delete cascade,
  name        text not null,
  slug        citext not null,
  -- Merchants order their own menu; ties break on name.
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint categories_name_len check (char_length(name) between 1 and 120),
  constraint categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create index if not exists categories_store_id_idx on public.categories (store_id);
-- Slugs only need to be unique within their store.
create unique index if not exists categories_store_slug_key on public.categories (store_id, slug);
create index if not exists categories_store_sort_idx on public.categories (store_id, sort_order, name);

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();
