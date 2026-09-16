-- 0003_customers.sql — customer profile, 1:1 with auth.users.
-- Checklist 1.1 and 1.20.
-- We never store passwords or manage identity here; Supabase Auth owns that
-- (decision D1). This table holds only the profile fields the portal shows.

create table if not exists public.customers (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         citext not null,
  full_name     text,
  phone         text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint customers_full_name_len check (full_name is null or char_length(full_name) between 1 and 120),
  constraint customers_phone_format  check (phone is null or phone ~ '^\+?[0-9]{7,15}$')
);

create unique index if not exists customers_email_key on public.customers (email);

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- Checklist 1.20: every auth.users signup gets a profile row automatically, so
-- the API never has to deal with a logged-in user that has no profile.
-- security definer because the trigger runs as the auth service, which has no
-- rights on public.customers.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.customers (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
