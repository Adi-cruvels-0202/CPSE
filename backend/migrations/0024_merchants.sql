-- 0024_merchants.sql — the shopkeeper's profile, 1:1 with auth.users.
-- MERGE_MAPPING D-2: one Supabase Auth for customers and merchants. A merchant
-- is an auth user with a row here, exactly as a customer is an auth user with a
-- row in public.customers — so the same person can be both with one login.
--
-- Unlike customers, no signup trigger creates this row: every signup is a
-- customer, and only `POST /merchant/auth/register` or `POST /merchant/onboard`
-- makes someone a merchant (MERCHANT_API.md, Merchant account).

create table if not exists public.merchants (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       citext not null,
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint merchants_full_name_len check (full_name is null or char_length(full_name) between 1 and 120),
  constraint merchants_phone_format  check (phone is null or phone ~ '^\+?[0-9]{7,15}$')
);

create unique index if not exists merchants_email_key on public.merchants (email);

drop trigger if exists merchants_set_updated_at on public.merchants;
create trigger merchants_set_updated_at
  before update on public.merchants
  for each row execute function public.set_updated_at();

-- Read and edit your own profile; the API creates the row (service role).
alter table public.merchants enable row level security;

drop policy if exists merchants_select_own on public.merchants;
create policy merchants_select_own on public.merchants
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists merchants_update_own on public.merchants;
create policy merchants_update_own on public.merchants
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
