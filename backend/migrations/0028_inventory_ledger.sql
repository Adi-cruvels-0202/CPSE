-- 0028_inventory_ledger.sql — every stock movement, append-only.
-- D-5 and MERCHANT_RULES §5. One row per change to a variant's on-hand or
-- reserved quantity, so "why is this 3?" always has an answer. Merchant-One
-- logged on-hand changes only; reserving and releasing left no trace (I-6), so
-- this ledger records both numbers.

do $$ begin
  create type inventory_movement as enum (
    'stock_in',          -- merchant received stock
    'stock_out',         -- merchant removed stock (damaged, expired, lost, …)
    'adjustment',        -- merchant set on-hand after a physical count
    'order_reserved',    -- an order was placed and holds the stock
    'order_released',    -- that order was rejected, cancelled or expired
    'order_fulfilled',   -- that order was completed; the stock left the shop
    'sale',              -- POS sale (P1)
    'purchase'           -- purchase from a supplier (P2)
  );
exception when duplicate_object then null; end $$;

create table if not exists public.inventory_ledger (
  id                uuid primary key default gen_random_uuid(),
  -- Restrict throughout: an audit trail must not disappear with what it audits.
  -- Products and variants are deactivated, never deleted (MERCHANT_RULES P-8).
  store_id          uuid not null references public.stores (id) on delete restrict,
  product_id        uuid not null references public.products (id) on delete restrict,
  variant_id        uuid not null references public.product_variants (id) on delete restrict,

  movement_type     inventory_movement not null,

  -- Signed changes, and the state they produced.
  on_hand_change    integer not null,
  reserved_change   integer not null,
  on_hand_after     integer not null,
  reserved_after    integer not null,

  unit_cost_paise   integer,
  reason            text,
  notes             text,

  -- What caused it: an order, a POS sale or a purchase. Null for a manual
  -- movement, which carries a reason instead.
  reference_type    text,
  reference_id      uuid,

  -- Who caused it. No FK: the actor is a merchant, a customer or nobody.
  performed_by_type text not null,
  performed_by_id   uuid,

  created_at        timestamptz not null default now(),

  constraint inventory_ledger_moves_something check (on_hand_change <> 0 or reserved_change <> 0),
  constraint inventory_ledger_after_nonneg    check (on_hand_after >= 0 and reserved_after >= 0),
  constraint inventory_ledger_after_valid     check (reserved_after <= on_hand_after),
  constraint inventory_ledger_unit_cost_nonneg check (unit_cost_paise is null or unit_cost_paise >= 0),
  constraint inventory_ledger_reason_len      check (reason is null or char_length(reason) between 1 and 300),
  constraint inventory_ledger_notes_len       check (notes is null or char_length(notes) <= 500),
  constraint inventory_ledger_reference_type  check (reference_type is null or reference_type in ('order', 'sale', 'purchase')),
  constraint inventory_ledger_reference_pair  check ((reference_type is null) = (reference_id is null)),
  constraint inventory_ledger_performed_by    check (performed_by_type in ('merchant', 'customer', 'system')),
  -- The system acts as nobody; a person always has an id.
  constraint inventory_ledger_actor_id        check ((performed_by_type = 'system') = (performed_by_id is null))
);

-- History screen: one store, newest first; and the per-variant / per-product filters.
create index if not exists inventory_ledger_store_id_idx
  on public.inventory_ledger (store_id, created_at desc);
create index if not exists inventory_ledger_variant_id_idx
  on public.inventory_ledger (variant_id, created_at desc);
create index if not exists inventory_ledger_product_id_idx
  on public.inventory_ledger (product_id, created_at desc);
-- "What did this order do to stock?" — release must undo exactly what was reserved.
create index if not exists inventory_ledger_reference_idx
  on public.inventory_ledger (reference_type, reference_id) where reference_id is not null;

-- Corrections are new movements, never edits — same rule as the khata ledger.
create or replace function public.reject_inventory_ledger_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'inventory_ledger rows are immutable; record a new movement instead';
end;
$$;

drop trigger if exists inventory_ledger_immutable on public.inventory_ledger;
create trigger inventory_ledger_immutable
  before update or delete on public.inventory_ledger
  for each row execute function public.reject_inventory_ledger_change();

-- A merchant may read their own stores' ledger; only the API writes it.
alter table public.inventory_ledger enable row level security;

drop policy if exists inventory_ledger_select_owner on public.inventory_ledger;
create policy inventory_ledger_select_owner on public.inventory_ledger
  for select to authenticated
  using (
    exists (select 1 from public.stores s
             where s.id = store_id and s.owner_id = (select auth.uid()))
  );
