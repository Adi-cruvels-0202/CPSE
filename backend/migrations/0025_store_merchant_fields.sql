-- 0025_store_merchant_fields.sql — what a merchant manages on a store.
-- MERGE_MAPPING §4.1 and MERCHANT_RULES §2. Additive only: every column has a
-- default that leaves the customer side behaving exactly as before.

do $$ begin
  create type shop_category as enum (
    'grocery', 'pharmacy', 'restaurant', 'bakery',
    'electronics', 'clothing', 'general', 'other'
  );
exception when duplicate_object then null; end $$;

-- Owner. Nullable because the stores seeded before merchants existed have
-- none until the seed script assigns its demo merchant. Restrict: a merchant
-- account cannot vanish from under a store that still has orders.
alter table public.stores
  add column if not exists owner_id uuid references public.merchants (id) on delete restrict;

create index if not exists stores_owner_id_idx on public.stores (owner_id);

-- is_published is the merchant's own switch; is_active stays the operator's
-- kill-switch. Customers see a store only when both are true.
--
-- Added with default TRUE so every store that exists today stays visible, then
-- the default flips to FALSE so a store the API creates starts unpublished
-- (MERCHANT_RULES S-6). On a re-run `add column if not exists` is a no-op, so
-- a store a merchant has since unpublished is never republished by this file.
alter table public.stores
  add column if not exists is_published boolean not null default true;
alter table public.stores
  alter column is_published set default false;

alter table public.stores
  add column if not exists shop_category shop_category;

-- Delivery settings that Merchant-One kept in its own table (MERGE_MAPPING
-- §4.1: they fold into stores). Both optional: no radius = no limit, no
-- threshold = delivery is never free.
alter table public.stores
  add column if not exists delivery_radius_km numeric(6, 2);
alter table public.stores
  add column if not exists free_delivery_threshold_paise integer;

-- Payment methods a customer may choose at checkout (MERCHANT_RULES S-16).
-- Same trick as is_published: today's stores keep accepting both, a new store
-- starts cash-only.
alter table public.stores
  add column if not exists accepts_cash boolean not null default true;
alter table public.stores
  add column if not exists accepts_online boolean not null default true;
alter table public.stores
  alter column accepts_online set default false;

do $$ begin
  alter table public.stores
    add constraint stores_delivery_radius_positive
    check (delivery_radius_km is null or delivery_radius_km > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.stores
    add constraint stores_free_delivery_threshold_nonneg
    check (free_delivery_threshold_paise is null or free_delivery_threshold_paise >= 0);
exception when duplicate_object then null; end $$;

-- Same reasoning as stores_one_mode_enabled: a store taking no payment method
-- could never receive an order.
do $$ begin
  alter table public.stores
    add constraint stores_one_payment_method check (accepts_cash or accepts_online);
exception when duplicate_object then null; end $$;

-- The merchant's store list, and the customer-facing "is it visible" test.
create index if not exists stores_published_idx
  on public.stores (is_published) where is_active and is_published;
