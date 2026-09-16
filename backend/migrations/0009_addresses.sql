-- 0009_addresses.sql — customer delivery addresses. Checklist 1.7.
-- Structured fields, not a free-text blob, because delivery fees and minimum
-- order rules are evaluated per address and the order snapshots them (D11).

create table if not exists public.addresses (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers (id) on delete cascade,
  label         text,                      -- 'Home', 'Office', ...
  recipient_name text not null,
  phone         text not null,
  line1         text not null,
  line2         text,
  landmark      text,
  city          text not null,
  state         text not null,
  postal_code   text not null,
  country       text not null default 'IN',
  latitude      numeric(9, 6),
  longitude     numeric(9, 6),
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint addresses_phone_format check (phone ~ '^\+?[0-9]{7,15}$'),
  constraint addresses_line1_len    check (char_length(line1) between 1 and 200),
  constraint addresses_city_len     check (char_length(city) between 1 and 100),
  constraint addresses_postal_len   check (char_length(postal_code) between 3 and 12),
  constraint addresses_latitude_range  check (latitude is null or latitude between -90 and 90),
  constraint addresses_longitude_range check (longitude is null or longitude between -180 and 180)
);

create index if not exists addresses_customer_id_idx on public.addresses (customer_id);
-- At most one default per customer, enforced by the database rather than by
-- application code that could race with itself.
create unique index if not exists addresses_one_default_per_customer
  on public.addresses (customer_id) where is_default;

drop trigger if exists addresses_set_updated_at on public.addresses;
create trigger addresses_set_updated_at
  before update on public.addresses
  for each row execute function public.set_updated_at();
