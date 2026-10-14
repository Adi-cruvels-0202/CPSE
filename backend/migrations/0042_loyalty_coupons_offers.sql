-- 0042_loyalty_coupons_offers.sql — merchant loyalty, coupons and local
-- offers, priced by the one engine and re-checked by create_order.
--
-- Roadmap §4 P3 Merchant loyalty (rules, rewards, history); Phase C
-- Expiry-based local offers, Location-based offer banner, Automatic offer
-- expiry; §5 P4 Merchant-specific loyalty, Points & rewards, Coupons,
-- First-order / repeat-customer benefits, Favourite-store benefits; §6
-- Loyalty flow.
--
-- The API prices a basket with its offers, coupon and points (src/lib/
-- pricing.js) and shows the customer that quote. create_order then re-checks
-- each one under a row lock — the offer is still live and has units left, the
-- coupon still has uses, the points are still there — and refuses the order
-- rather than honour something that has gone. Usage is recorded in the same
-- transaction, so two orders at once cannot both take the last use or the
-- same points. Ending an order hands back what it used; completing it earns.

-- ── Loyalty ─────────────────────────────────────────────────────────────────
create table if not exists public.loyalty_programs (
  store_id                uuid primary key references public.stores (id) on delete cascade,
  is_active               boolean not null default false,
  -- Points earned per ₹100 of eligible spend (subtotal after discounts).
  earn_points_per_100     integer not null default 1,
  -- What one point is worth at redemption, in paise.
  point_value_paise       integer not null default 100,
  min_order_paise_to_earn integer not null default 0,
  min_redeem_points       integer not null default 0,
  -- At most this share of the order's item value may be paid with points.
  max_redeem_percent      integer not null default 50,
  welcome_bonus_points    integer not null default 0,
  points_expire_days      integer,
  updated_at              timestamptz not null default now(),
  created_at              timestamptz not null default now(),

  constraint loyalty_programs_earn_range check (earn_points_per_100 between 0 and 1000),
  constraint loyalty_programs_value_range check (point_value_paise between 1 and 100000),
  constraint loyalty_programs_min_order_nonneg check (min_order_paise_to_earn >= 0),
  constraint loyalty_programs_min_redeem_nonneg check (min_redeem_points >= 0),
  constraint loyalty_programs_max_redeem_range check (max_redeem_percent between 0 and 100),
  constraint loyalty_programs_bonus_nonneg check (welcome_bonus_points between 0 and 100000),
  constraint loyalty_programs_expiry_range check (points_expire_days is null or points_expire_days between 30 and 3650)
);

drop trigger if exists loyalty_programs_set_updated_at on public.loyalty_programs;
create trigger loyalty_programs_set_updated_at before update on public.loyalty_programs
  for each row execute function public.set_updated_at();

create table if not exists public.loyalty_accounts (
  store_id           uuid not null references public.stores (id) on delete cascade,
  customer_id        uuid not null references public.customers (id) on delete cascade,
  -- Maintained from the ledger by trigger; never written by hand.
  current_points     integer not null default 0,
  lifetime_earned    integer not null default 0,
  lifetime_redeemed  integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  primary key (store_id, customer_id),
  constraint loyalty_accounts_points_nonneg check (current_points >= 0)
);

create index if not exists loyalty_accounts_customer_id_idx on public.loyalty_accounts (customer_id);

drop trigger if exists loyalty_accounts_set_updated_at on public.loyalty_accounts;
create trigger loyalty_accounts_set_updated_at before update on public.loyalty_accounts
  for each row execute function public.set_updated_at();

create table if not exists public.loyalty_rewards (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores (id) on delete cascade,
  name         text not null,
  description  text,
  points_cost  integer not null,
  -- A reward is redeemed into a personal, single-use coupon for this value.
  discount_type text not null default 'flat',
  percent_off   integer,
  amount_off_paise integer,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint loyalty_rewards_name_len check (char_length(name) between 1 and 80),
  constraint loyalty_rewards_cost_positive check (points_cost between 1 and 1000000),
  constraint loyalty_rewards_type check (discount_type in ('flat', 'percent', 'free_delivery')),
  constraint loyalty_rewards_value check (
    (discount_type = 'percent' and percent_off between 1 and 100 and amount_off_paise is null)
    or (discount_type = 'flat' and amount_off_paise between 1 and 100000000 and percent_off is null)
    or (discount_type = 'free_delivery' and percent_off is null and amount_off_paise is null)
  )
);

create index if not exists loyalty_rewards_store_id_idx on public.loyalty_rewards (store_id);

drop trigger if exists loyalty_rewards_set_updated_at on public.loyalty_rewards;
create trigger loyalty_rewards_set_updated_at before update on public.loyalty_rewards
  for each row execute function public.set_updated_at();

create table if not exists public.loyalty_ledger (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references public.stores (id) on delete cascade,
  customer_id     uuid not null references public.customers (id) on delete cascade,
  order_id        uuid references public.orders (id) on delete cascade,
  reward_id       uuid references public.loyalty_rewards (id) on delete set null,
  kind            text not null,
  points          integer not null,
  points_after   integer not null,
  note            text,
  created_by_type text not null default 'system',
  created_by_id   uuid,
  created_at      timestamptz not null default now(),

  constraint loyalty_ledger_kind check (kind in (
    'earn', 'bonus', 'redeem', 'reverse_redeem', 'reward', 'adjust', 'expire'
  )),
  constraint loyalty_ledger_points_nonzero check (points <> 0),
  constraint loyalty_ledger_direction check (
    (kind in ('earn', 'bonus', 'reverse_redeem') and points > 0)
    or (kind in ('redeem', 'reward', 'expire') and points < 0)
    or kind = 'adjust'
  ),
  constraint loyalty_ledger_points_after_nonneg check (points_after >= 0),
  constraint loyalty_ledger_note_len check (note is null or char_length(note) <= 300),
  constraint loyalty_ledger_created_by check (created_by_type in ('system', 'merchant', 'customer'))
);

create index if not exists loyalty_ledger_account_idx on public.loyalty_ledger (store_id, customer_id, created_at desc);
create index if not exists loyalty_ledger_customer_id_idx on public.loyalty_ledger (customer_id);
create index if not exists loyalty_ledger_order_id_idx on public.loyalty_ledger (order_id);
create index if not exists loyalty_ledger_reward_id_idx on public.loyalty_ledger (reward_id);
-- One earn, one bonus, one redeem and one reversal per order: replays and
-- double triggers cannot add points twice.
create unique index if not exists loyalty_ledger_once_per_order
  on public.loyalty_ledger (order_id, kind)
  where order_id is not null and kind in ('earn', 'bonus', 'redeem', 'reverse_redeem');

create or replace function public.reject_loyalty_ledger_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_setting('cpse.deleting_store', true) = 'on' then
    return old;
  end if;
  raise exception 'loyalty_ledger rows are immutable; record an adjustment instead';
end;
$$;

drop trigger if exists loyalty_ledger_immutable on public.loyalty_ledger;
create trigger loyalty_ledger_immutable before update or delete on public.loyalty_ledger
  for each row execute function public.reject_loyalty_ledger_change();

-- The single writer of points. Locks the account, refuses to go below zero,
-- and returns the new balance.
create or replace function public.post_loyalty_points(
  p_store_id uuid, p_customer_id uuid, p_kind text, p_points integer,
  p_order_id uuid default null, p_reward_id uuid default null, p_note text default null,
  p_created_by_type text default 'system', p_created_by_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  insert into public.loyalty_accounts (store_id, customer_id) values (p_store_id, p_customer_id)
  on conflict (store_id, customer_id) do nothing;

  select current_points into v_balance from public.loyalty_accounts
   where store_id = p_store_id and customer_id = p_customer_id for update;

  if v_balance + p_points < 0 then
    raise exception 'INSUFFICIENT_POINTS:%', v_balance using errcode = 'P0001';
  end if;

  insert into public.loyalty_ledger (store_id, customer_id, order_id, reward_id, kind, points, points_after, note, created_by_type, created_by_id)
  values (p_store_id, p_customer_id, p_order_id, p_reward_id, p_kind, p_points, v_balance + p_points, p_note, p_created_by_type, p_created_by_id);

  update public.loyalty_accounts
     set current_points = current_points + p_points,
         lifetime_earned = lifetime_earned + case when p_points > 0 and p_kind in ('earn', 'bonus', 'adjust') then p_points else 0 end,
         lifetime_redeemed = lifetime_redeemed + case when p_kind in ('redeem', 'reward') then -p_points
                                                      when p_kind = 'reverse_redeem' then -p_points else 0 end
   where store_id = p_store_id and customer_id = p_customer_id;

  return v_balance + p_points;
end;
$$;

revoke all on function public.post_loyalty_points(uuid, uuid, text, integer, uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.post_loyalty_points(uuid, uuid, text, integer, uuid, uuid, text, text, uuid) to service_role;

-- ── Coupons ─────────────────────────────────────────────────────────────────
create table if not exists public.coupons (
  id                        uuid primary key default gen_random_uuid(),
  store_id                  uuid not null references public.stores (id) on delete cascade,
  code                      citext not null,
  title                     text not null,
  description               text,
  discount_type             text not null,
  percent_off               integer,
  amount_off_paise          integer,
  max_discount_paise        integer,
  min_order_paise           integer not null default 0,
  starts_at                 timestamptz not null default now(),
  ends_at                   timestamptz,
  max_uses         integer,
  max_uses_per_customer  integer not null default 1,
  -- Who may use it: everyone, first-time buyers at this store, returning
  -- buyers, loyal customers, followers of the store, or the customer on
  -- their (consented) birthday.
  audience                  text not null default 'all',
  -- A personal coupon (a redeemed reward, a goodwill gesture) for one customer.
  customer_id               uuid references public.customers (id) on delete cascade,
  stackable_with_loyalty    boolean not null default false,
  is_active                 boolean not null default true,
  source                    text not null default 'merchant',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint coupons_code_format check (code ~ '^[A-Za-z0-9_-]{3,30}$'),
  constraint coupons_title_len check (char_length(title) between 1 and 80),
  constraint coupons_type check (discount_type in ('percent', 'flat', 'free_delivery')),
  constraint coupons_value check (
    (discount_type = 'percent' and percent_off between 1 and 100 and amount_off_paise is null)
    or (discount_type = 'flat' and amount_off_paise between 1 and 100000000 and percent_off is null)
    or (discount_type = 'free_delivery' and percent_off is null and amount_off_paise is null)
  ),
  constraint coupons_max_discount_nonneg check (max_discount_paise is null or max_discount_paise > 0),
  constraint coupons_min_order_nonneg check (min_order_paise >= 0),
  constraint coupons_window check (ends_at is null or ends_at > starts_at),
  constraint coupons_limits check (
    (max_uses is null or max_uses > 0) and max_uses_per_customer between 1 and 1000
  ),
  constraint coupons_audience check (audience in ('all', 'new', 'returning', 'loyal', 'followers', 'birthday')),
  constraint coupons_source check (source in ('merchant', 'reward'))
);

create unique index if not exists coupons_store_code_key on public.coupons (store_id, code);
create index if not exists coupons_customer_id_idx on public.coupons (customer_id);

drop trigger if exists coupons_set_updated_at on public.coupons;
create trigger coupons_set_updated_at before update on public.coupons
  for each row execute function public.set_updated_at();

create table if not exists public.coupon_redemptions (
  id                     uuid primary key default gen_random_uuid(),
  coupon_id              uuid not null references public.coupons (id) on delete cascade,
  order_id               uuid not null references public.orders (id) on delete cascade,
  customer_id            uuid not null references public.customers (id) on delete cascade,
  store_id               uuid not null references public.stores (id) on delete cascade,
  discount_paise         integer not null default 0,
  waived_delivery_paise  integer not null default 0,
  status                 text not null default 'applied',
  created_at             timestamptz not null default now(),
  reversed_at            timestamptz,

  constraint coupon_redemptions_amounts check (discount_paise >= 0 and waived_delivery_paise >= 0),
  constraint coupon_redemptions_status check (status in ('applied', 'reversed')),
  constraint coupon_redemptions_reversed_stamp check ((status = 'reversed') = (reversed_at is not null))
);

create unique index if not exists coupon_redemptions_order_key on public.coupon_redemptions (order_id);
create index if not exists coupon_redemptions_coupon_id_idx on public.coupon_redemptions (coupon_id, status);
create index if not exists coupon_redemptions_customer_id_idx on public.coupon_redemptions (customer_id);
create index if not exists coupon_redemptions_store_id_idx on public.coupon_redemptions (store_id);

-- ── Local offers (expiry clearance and promotions) ──────────────────────────
create table if not exists public.store_offers (
  id                   uuid primary key default gen_random_uuid(),
  store_id             uuid not null references public.stores (id) on delete cascade,
  product_id           uuid not null references public.products (id) on delete cascade,
  variant_id           uuid not null references public.product_variants (id) on delete cascade,
  -- An expiry offer clears one lot; its expiry drives the safety cut-off.
  batch_id             uuid references public.inventory_batches (id) on delete set null,
  kind                 text not null default 'expiry',
  title                text not null,
  description          text,
  offer_price_paise    integer not null,
  starts_at            timestamptz not null default now(),
  ends_at              timestamptz not null,
  quantity_limit       integer,
  quantity_sold        integer not null default 0,
  -- Customers within this distance of the store see the banner.
  radius_km            numeric(6, 2) not null default 5,
  -- Stop selling this many days before the batch expires (food safety).
  expiry_cutoff_days   integer not null default 0,
  is_active            boolean not null default true,
  ended_at             timestamptz,
  end_reason           text,
  created_by           uuid references public.merchants (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint store_offers_kind check (kind in ('expiry', 'promotion')),
  constraint store_offers_title_len check (char_length(title) between 1 and 80),
  constraint store_offers_description_len check (description is null or char_length(description) <= 300),
  constraint store_offers_price_nonneg check (offer_price_paise >= 0),
  constraint store_offers_window check (ends_at > starts_at),
  constraint store_offers_quantity check (
    (quantity_limit is null or quantity_limit > 0) and quantity_sold >= 0
    and (quantity_limit is null or quantity_sold <= quantity_limit)
  ),
  constraint store_offers_radius check (radius_km > 0 and radius_km <= 50),
  constraint store_offers_cutoff check (expiry_cutoff_days between 0 and 365),
  constraint store_offers_end_reason check (
    end_reason is null or end_reason in ('manual', 'period_ended', 'sold_out', 'expiry_cutoff', 'stock_unavailable')
  ),
  constraint store_offers_ended_pair check ((ended_at is null) = (end_reason is null))
);

create index if not exists store_offers_store_id_idx on public.store_offers (store_id, ends_at);
create index if not exists store_offers_product_id_idx on public.store_offers (product_id);
create index if not exists store_offers_batch_id_idx on public.store_offers (batch_id);
create index if not exists store_offers_created_by_idx on public.store_offers (created_by);
create index if not exists store_offers_live_idx on public.store_offers (ends_at) where is_active and ended_at is null;
-- One live offer per variant keeps a line's price unambiguous.
create unique index if not exists store_offers_one_live_per_variant
  on public.store_offers (variant_id) where is_active and ended_at is null;

drop trigger if exists store_offers_set_updated_at on public.store_offers;
create trigger store_offers_set_updated_at before update on public.store_offers
  for each row execute function public.set_updated_at();

-- Whether an offer may be sold right now, and if not, why. The single
-- definition the API mirrors (src/lib/offers.js) and create_order enforces.
create or replace function public.offer_end_reason(p_offer public.store_offers, p_quantity integer default 1)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_today   date;
  v_expires date;
begin
  if not p_offer.is_active or p_offer.ended_at is not null then
    return coalesce(p_offer.end_reason, 'manual');
  end if;
  if now() >= p_offer.ends_at then
    return 'period_ended';
  end if;
  if p_offer.quantity_limit is not null and p_offer.quantity_sold + p_quantity > p_offer.quantity_limit then
    return 'sold_out';
  end if;
  if p_offer.batch_id is not null then
    select b.expires_on, (now() at time zone s.timezone)::date into v_expires, v_today
      from public.inventory_batches b join public.stores s on s.id = b.store_id
     where b.id = p_offer.batch_id;
    if v_expires is not null and v_today > v_expires - p_offer.expiry_cutoff_days then
      return 'expiry_cutoff';
    end if;
  end if;
  return null;
end;
$$;

-- ── Order columns for what was applied ──────────────────────────────────────
alter table public.order_items add column if not exists offer_id uuid references public.store_offers (id) on delete set null;
-- The variant's own price, when an offer priced the line lower.
alter table public.order_items add column if not exists list_unit_price_paise integer;
-- This line's share of the order discount; its tax is on the price after it.
alter table public.order_items add column if not exists discount_paise integer not null default 0;
create index if not exists order_items_offer_id_idx on public.order_items (offer_id);

do $$ begin
  alter table public.order_items
    add constraint order_items_discount_nonneg check (discount_paise >= 0 and discount_paise <= unit_price_paise * quantity);
exception when duplicate_object then null; end $$;

alter table public.orders add column if not exists coupon_code text;
alter table public.orders add column if not exists loyalty_points_redeemed integer not null default 0;
alter table public.orders add column if not exists substitution_preference text not null default 'contact_me';

do $$ begin
  alter table public.orders
    add constraint orders_loyalty_points_nonneg check (loyalty_points_redeemed >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.orders
    add constraint orders_substitution_preference check (substitution_preference in ('contact_me', 'allow_similar', 'no_substitutions'));
exception when duplicate_object then null; end $$;

-- ── Row level security ──────────────────────────────────────────────────────
alter table public.loyalty_programs enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_rewards enable row level security;
alter table public.loyalty_ledger enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.store_offers enable row level security;

drop policy if exists loyalty_accounts_select_own on public.loyalty_accounts;
create policy loyalty_accounts_select_own on public.loyalty_accounts
  for select to authenticated using (customer_id = (select auth.uid()));
drop policy if exists loyalty_ledger_select_own on public.loyalty_ledger;
create policy loyalty_ledger_select_own on public.loyalty_ledger
  for select to authenticated using (customer_id = (select auth.uid()));
drop policy if exists coupon_redemptions_select_own on public.coupon_redemptions;
create policy coupon_redemptions_select_own on public.coupon_redemptions
  for select to authenticated using (customer_id = (select auth.uid()));
drop policy if exists loyalty_programs_select_owner on public.loyalty_programs;
create policy loyalty_programs_select_owner on public.loyalty_programs
  for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));
drop policy if exists loyalty_rewards_select_owner on public.loyalty_rewards;
create policy loyalty_rewards_select_owner on public.loyalty_rewards
  for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));
drop policy if exists coupons_select_owner on public.coupons;
create policy coupons_select_owner on public.coupons
  for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));
-- A live offer at a published store is public, like the catalogue.
drop policy if exists store_offers_public_read on public.store_offers;
create policy store_offers_public_read on public.store_offers
  for select to anon, authenticated
  using (is_active and ended_at is null
         and exists (select 1 from public.stores s where s.id = store_id and s.is_active and s.is_published));

-- ── create_order: offers, coupon and points, re-checked and recorded ────────
-- Same contract as 0037. New payload fields:
--   items[].offer_id, items[].list_unit_price_paise, items[].discount_paise
--   coupon: { coupon_id, code, discount_paise, waived_delivery_paise } | null
--   loyalty: { points, discount_paise } | null
--   substitution_preference
-- New refusals: OFFER_ENDED:<product name>, COUPON_INVALID:<reason>,
-- INSUFFICIENT_POINTS:<balance>.
create or replace function public.create_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id     uuid := (payload ->> 'customer_id')::uuid;
  v_store_id        uuid := (payload ->> 'store_id')::uuid;
  v_cart_id         uuid := nullif(payload ->> 'cart_id', '')::uuid;
  v_idempotency_key text := nullif(payload ->> 'idempotency_key', '');
  v_status          order_status := (payload ->> 'status')::order_status;
  v_method          text := coalesce(nullif(payload ->> 'payment_method', ''),
                                     case when payload -> 'payment' is not null
                                           and payload -> 'payment' <> 'null'::jsonb then 'online' else 'cash' end);
  v_total           integer := (payload ->> 'total_paise')::integer;
  v_coupon_in       jsonb := nullif(payload -> 'coupon', 'null'::jsonb);
  v_loyalty_in      jsonb := nullif(payload -> 'loyalty', 'null'::jsonb);
  v_order_id        uuid;
  v_order_number    text;
  v_item            jsonb;
  v_product_id      uuid;
  v_variant_id      uuid;
  v_quantity        integer;
  v_tracked         boolean;
  v_on_hand         integer;
  v_reserved        integer;
  v_offer           public.store_offers%rowtype;
  v_reason          text;
  v_coupon          public.coupons%rowtype;
  v_used_total      integer;
  v_used_by_me      integer;
  v_account         record;
  v_due_days        integer;
  v_timezone        text;
begin
  if v_idempotency_key is not null then
    select id, order_number into v_order_id, v_order_number
      from public.orders
     where customer_id = v_customer_id
       and idempotency_key = v_idempotency_key;
    if found then
      return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'replayed', true);
    end if;
  end if;

  insert into public.orders (
    store_id, customer_id, fulfilment_mode, status, payment_status, payment_method,
    address_id, delivery_address, store_snapshot,
    subtotal_paise, discount_paise, delivery_fee_paise, tax_paise, total_paise,
    customer_note, idempotency_key, coupon_code, loyalty_points_redeemed, substitution_preference
  ) values (
    v_store_id, v_customer_id,
    (payload ->> 'fulfilment_mode')::fulfilment_mode,
    v_status,
    (payload ->> 'payment_status')::payment_status,
    v_method,
    nullif(payload ->> 'address_id', '')::uuid,
    payload -> 'delivery_address',
    payload -> 'store_snapshot',
    (payload ->> 'subtotal_paise')::integer,
    (payload ->> 'discount_paise')::integer,
    (payload ->> 'delivery_fee_paise')::integer,
    (payload ->> 'tax_paise')::integer,
    v_total,
    nullif(payload ->> 'customer_note', ''),
    v_idempotency_key,
    v_coupon_in ->> 'code',
    coalesce((v_loyalty_in ->> 'points')::integer, 0),
    coalesce(nullif(payload ->> 'substitution_preference', ''), 'contact_me')
  )
  returning id, order_number into v_order_id, v_order_number;

  for v_item in
    select value from jsonb_array_elements(payload -> 'items') order by value ->> 'variant_id'
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_variant_id := nullif(v_item ->> 'variant_id', '')::uuid;
    v_quantity   := (v_item ->> 'quantity')::integer;

    select p.track_inventory, v.quantity_on_hand, v.reserved_quantity
      into v_tracked, v_on_hand, v_reserved
      from public.product_variants v
      join public.products p on p.id = v.product_id
     where v.id = v_variant_id
       and p.id = v_product_id
       and p.store_id = v_store_id
       and p.is_available
       and p.archived_at is null
       and v.is_available
       for update of v;

    if not found or (v_tracked and v_on_hand - v_reserved < v_quantity) then
      raise exception 'ITEM_UNAVAILABLE:%', coalesce(v_item ->> 'product_name', 'An item') using errcode = 'P0001';
    end if;

    -- An offer price is honoured only if the offer can still sell this many.
    if nullif(v_item ->> 'offer_id', '') is not null then
      select * into v_offer from public.store_offers
       where id = (v_item ->> 'offer_id')::uuid and variant_id = v_variant_id and store_id = v_store_id
         for update;
      if not found then
        raise exception 'OFFER_ENDED:%', coalesce(v_item ->> 'product_name', 'An item') using errcode = 'P0001';
      end if;
      v_reason := public.offer_end_reason(v_offer, v_quantity);
      if v_reason is not null or v_offer.offer_price_paise <> (v_item ->> 'unit_price_paise')::integer then
        raise exception 'OFFER_ENDED:%', coalesce(v_item ->> 'product_name', 'An item') using errcode = 'P0001';
      end if;
      update public.store_offers
         set quantity_sold = quantity_sold + v_quantity,
             ended_at = case when quantity_limit is not null and quantity_sold + v_quantity >= quantity_limit then now() end,
             end_reason = case when quantity_limit is not null and quantity_sold + v_quantity >= quantity_limit then 'sold_out' end
       where id = v_offer.id;
    end if;

    insert into public.order_items (
      order_id, product_id, variant_id, product_name, variant_name, sku,
      image_url, unit_price_paise, quantity, tax_percent, tax_paise, line_total_paise,
      offer_id, list_unit_price_paise, discount_paise
    ) values (
      v_order_id, v_product_id, v_variant_id,
      v_item ->> 'product_name',
      nullif(v_item ->> 'variant_name', ''),
      nullif(v_item ->> 'sku', ''),
      nullif(v_item ->> 'image_url', ''),
      (v_item ->> 'unit_price_paise')::integer,
      v_quantity,
      coalesce((v_item ->> 'tax_percent')::numeric, 0),
      coalesce((v_item ->> 'tax_paise')::integer, 0),
      (v_item ->> 'line_total_paise')::integer,
      nullif(v_item ->> 'offer_id', '')::uuid,
      nullif(v_item ->> 'list_unit_price_paise', '')::integer,
      coalesce((v_item ->> 'discount_paise')::integer, 0)
    );

    if v_tracked then
      update public.product_variants
         set reserved_quantity = reserved_quantity + v_quantity
       where id = v_variant_id
       returning quantity_on_hand, reserved_quantity into v_on_hand, v_reserved;

      insert into public.inventory_ledger (
        store_id, product_id, variant_id, movement_type,
        on_hand_change, reserved_change, on_hand_after, reserved_after,
        reference_type, reference_id, performed_by_type, performed_by_id
      ) values (
        v_store_id, v_product_id, v_variant_id, 'order_reserved',
        0, v_quantity, v_on_hand, v_reserved,
        'order', v_order_id, 'customer', v_customer_id
      );
    end if;
  end loop;

  -- The coupon: still active, in its window, under both usage limits.
  if v_coupon_in is not null then
    select * into v_coupon from public.coupons
     where id = (v_coupon_in ->> 'coupon_id')::uuid and store_id = v_store_id
       for update;
    if not found or not v_coupon.is_active then
      raise exception 'COUPON_INVALID:inactive' using errcode = 'P0001';
    end if;
    if now() < v_coupon.starts_at or (v_coupon.ends_at is not null and now() >= v_coupon.ends_at) then
      raise exception 'COUPON_INVALID:expired' using errcode = 'P0001';
    end if;
    if v_coupon.customer_id is not null and v_coupon.customer_id <> v_customer_id then
      raise exception 'COUPON_INVALID:not_yours' using errcode = 'P0001';
    end if;
    select count(*) filter (where true), count(*) filter (where customer_id = v_customer_id)
      into v_used_total, v_used_by_me
      from public.coupon_redemptions where coupon_id = v_coupon.id and status = 'applied';
    if v_coupon.max_uses is not null and v_used_total >= v_coupon.max_uses then
      raise exception 'COUPON_INVALID:used_up' using errcode = 'P0001';
    end if;
    if v_used_by_me >= v_coupon.max_uses_per_customer then
      raise exception 'COUPON_INVALID:already_used' using errcode = 'P0001';
    end if;
    insert into public.coupon_redemptions (coupon_id, order_id, customer_id, store_id, discount_paise, waived_delivery_paise)
    values (v_coupon.id, v_order_id, v_customer_id, v_store_id,
            coalesce((v_coupon_in ->> 'discount_paise')::integer, 0),
            coalesce((v_coupon_in ->> 'waived_delivery_paise')::integer, 0));
  end if;

  -- Points: taken from the balance under its lock.
  if v_loyalty_in is not null and coalesce((v_loyalty_in ->> 'points')::integer, 0) > 0 then
    perform public.post_loyalty_points(
      v_store_id, v_customer_id, 'redeem', -((v_loyalty_in ->> 'points')::integer), v_order_id, null,
      'Redeemed on order ' || v_order_number, 'customer', v_customer_id
    );
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (v_order_id, null, v_status, 'customer', payload ->> 'history_note');

  if payload -> 'payment' is not null and payload -> 'payment' <> 'null'::jsonb then
    insert into public.payments (order_id, provider, amount_paise, currency, status)
    values (
      v_order_id,
      payload -> 'payment' ->> 'provider',
      (payload -> 'payment' ->> 'amount_paise')::integer,
      coalesce(payload -> 'payment' ->> 'currency', 'INR'),
      coalesce((payload -> 'payment' ->> 'status')::payment_status, 'pending')
    );
  end if;

  if v_method = 'khata' then
    select s.khata_due_days, s.timezone into v_due_days, v_timezone
      from public.stores s where s.id = v_store_id and s.khata_enabled;
    if not found then
      raise exception 'KHATA_UNAVAILABLE' using errcode = 'P0001';
    end if;

    select * into v_account from public.khata_accounts
     where customer_id = v_customer_id and store_id = v_store_id and is_active
       for update;
    if not found or v_account.credit_limit_paise is null then
      raise exception 'KHATA_UNAVAILABLE' using errcode = 'P0001';
    end if;
    if v_account.balance_paise + v_total > v_account.credit_limit_paise then
      raise exception 'KHATA_LIMIT_EXCEEDED:%', greatest(v_account.credit_limit_paise - v_account.balance_paise, 0)
        using errcode = 'P0001';
    end if;

    if v_total > 0 then
      insert into public.khata_transactions (
        account_id, type, amount_paise, description, order_id, entry_kind, due_date,
        recorded_by_type, recorded_by_id
      ) values (
        v_account.id, 'debit', v_total, 'Order ' || v_order_number, v_order_id, 'charge',
        (now() at time zone v_timezone)::date + v_due_days,
        'customer', v_customer_id
      );

      insert into public.payments (order_id, provider, amount_paise, currency, status, paid_at, raw_payload)
      values (v_order_id, 'khata', v_total, 'INR', 'paid', now(), jsonb_build_object('account_id', v_account.id));

      update public.orders set payment_status = 'paid' where id = v_order_id;
    end if;
  end if;

  if v_cart_id is not null then
    update public.carts set checked_out_at = now() where id = v_cart_id and customer_id = v_customer_id;
    delete from public.cart_items where cart_id = v_cart_id;
  end if;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'replayed', false);
end;
$$;

revoke all on function public.create_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_order(jsonb) to service_role;

-- ── Ending or completing an order settles what it used ──────────────────────
-- Cancelled / rejected: the coupon use is released and redeemed points come
-- back, as new ledger rows. Completed: points are earned (once), plus the
-- welcome bonus on the customer's first completed order at the store.
create or replace function public.settle_order_benefits()
returns trigger
language plpgsql
as $$
declare
  v_program  public.loyalty_programs%rowtype;
  v_redeemed integer;
  v_points   integer;
  v_eligible integer;
begin
  if new.status in ('cancelled', 'rejected') then
    update public.coupon_redemptions set status = 'reversed', reversed_at = now()
     where order_id = new.id and status = 'applied';

    select -points into v_redeemed from public.loyalty_ledger where order_id = new.id and kind = 'redeem';
    if v_redeemed is not null and v_redeemed > 0
       and not exists (select 1 from public.loyalty_ledger where order_id = new.id and kind = 'reverse_redeem') then
      perform public.post_loyalty_points(new.store_id, new.customer_id, 'reverse_redeem', v_redeemed, new.id, null,
                                         'Returned: order ' || new.order_number || ' ' || new.status::text);
    end if;
    return null;
  end if;

  if new.status = 'completed' then
    select * into v_program from public.loyalty_programs where store_id = new.store_id and is_active;
    if not found then
      return null;
    end if;
    v_eligible := new.subtotal_paise - new.discount_paise;
    if v_eligible >= v_program.min_order_paise_to_earn then
      v_points := (v_eligible / 10000) * v_program.earn_points_per_100;
      if v_points > 0 and not exists (select 1 from public.loyalty_ledger where order_id = new.id and kind = 'earn') then
        perform public.post_loyalty_points(new.store_id, new.customer_id, 'earn', v_points, new.id, null,
                                           'Earned on order ' || new.order_number);
      end if;
    end if;
    if v_program.welcome_bonus_points > 0
       and not exists (select 1 from public.orders o where o.store_id = new.store_id and o.customer_id = new.customer_id
                         and o.status = 'completed' and o.id <> new.id)
       and not exists (select 1 from public.loyalty_ledger where order_id = new.id and kind = 'bonus') then
      perform public.post_loyalty_points(new.store_id, new.customer_id, 'bonus', v_program.welcome_bonus_points, new.id, null,
                                         'Welcome bonus — first order');
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists orders_settle_benefits on public.orders;
create trigger orders_settle_benefits
  after update of status on public.orders
  for each row
  when (old.status is distinct from new.status and new.status in ('cancelled', 'rejected', 'completed'))
  execute function public.settle_order_benefits();

-- ── Redeeming a reward into a personal coupon ───────────────────────────────
-- Points and the coupon in one transaction. Returns the coupon id.
create or replace function public.redeem_loyalty_reward(p_store_id uuid, p_customer_id uuid, p_reward_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward public.loyalty_rewards%rowtype;
  v_coupon uuid;
  v_code   text;
begin
  select * into v_reward from public.loyalty_rewards where id = p_reward_id and store_id = p_store_id and is_active;
  if not found then
    raise exception 'REWARD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.loyalty_programs where store_id = p_store_id and is_active) then
    raise exception 'PROGRAM_INACTIVE' using errcode = 'P0001';
  end if;

  perform public.post_loyalty_points(p_store_id, p_customer_id, 'reward', -v_reward.points_cost, null, v_reward.id,
                                     'Redeemed for ' || v_reward.name, 'customer', p_customer_id);

  v_code := 'RWD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.coupons (
    store_id, code, title, description, discount_type, percent_off, amount_off_paise, max_uses,
    max_uses_per_customer, customer_id, source, ends_at
  ) values (
    p_store_id, v_code, v_reward.name, v_reward.description, v_reward.discount_type,
    v_reward.percent_off, v_reward.amount_off_paise, 1,
    1, p_customer_id, 'reward', now() + interval '90 days'
  )
  returning id into v_coupon;
  return v_coupon;
end;
$$;

revoke all on function public.redeem_loyalty_reward(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.redeem_loyalty_reward(uuid, uuid, uuid) to service_role;
revoke all on function public.offer_end_reason(public.store_offers, integer) from public, anon, authenticated;
grant execute on function public.offer_end_reason(public.store_offers, integer) to service_role;

-- ── delete_store learns about loyalty, coupons and offers ───────────────────
-- (Their own rows cascade from the store; the loyalty ledger is append-only
-- and allows the delete only inside delete_store, as the other ledgers do.)
