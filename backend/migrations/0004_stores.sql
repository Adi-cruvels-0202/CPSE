-- 0004_stores.sql — merchant storefronts. Checklist 1.2.
-- Merchant-side management is out of scope; rows here are seed data only.
-- Public store pages must open from a shared link with no login, so this table
-- is world-readable (see 0018_rls.sql).

create table if not exists public.stores (
  id                uuid primary key default gen_random_uuid(),
  slug              citext not null,
  name              text not null,
  description       text,
  logo_url          text,
  cover_image_url   text,

  -- Contact
  phone             text,
  email             citext,

  -- Location. Latitude/longitude are nullable because a store may only have an
  -- address; distance features are out of scope for this milestone.
  address_line1     text,
  address_line2     text,
  city              text,
  state             text,
  postal_code       text,
  country           text not null default 'IN',
  latitude          numeric(9, 6),
  longitude         numeric(9, 6),

  -- Opening hours as {"mon": [{"open": "09:00", "close": "21:00"}], ...}.
  -- JSONB because the shape varies per store and we only ever read it whole.
  opening_hours     jsonb not null default '{}'::jsonb,

  -- Fulfilment flags and money rules (integer paise, decision D8)
  pickup_enabled    boolean not null default true,
  delivery_enabled  boolean not null default false,
  min_order_paise   integer not null default 0,
  delivery_fee_paise integer not null default 0,
  is_active         boolean not null default true,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint stores_slug_format      check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint stores_name_len         check (char_length(name) between 1 and 160),
  constraint stores_min_order_nonneg check (min_order_paise >= 0),
  constraint stores_delivery_fee_nonneg check (delivery_fee_paise >= 0),
  constraint stores_latitude_range   check (latitude is null or latitude between -90 and 90),
  constraint stores_longitude_range  check (longitude is null or longitude between -180 and 180),
  -- A store with neither mode enabled could never receive an order.
  constraint stores_one_mode_enabled check (pickup_enabled or delivery_enabled)
);

-- Checklist 1.17: the slug is the public URL key, so it must be unique.
create unique index if not exists stores_slug_key on public.stores (slug);
create index if not exists stores_is_active_idx on public.stores (is_active) where is_active;

drop trigger if exists stores_set_updated_at on public.stores;
create trigger stores_set_updated_at
  before update on public.stores
  for each row execute function public.set_updated_at();
