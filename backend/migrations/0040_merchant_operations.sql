-- 0040_merchant_operations.sql — the merchant's routine work, made safe.
--
-- Roadmap §4 P1: Industry templates, Categories (remove, reorder), Workflow
-- defaults, Purchase management, Batch & expiry, Inventory ledger, Barcode
-- support. "Merchant setup → catalogue → product master → purchase entry →
-- validation → inventory ledger → batch/expiry retention → stock visibility →
-- customer availability."

-- ── Industry and workflow defaults ──────────────────────────────────────────
alter type shop_category add value if not exists 'stationery';

-- Defaults a template sets and the merchant may change at any time. Nothing
-- reads them as rules: they only pre-fill new products and drive alerts.
alter table public.stores add column if not exists default_low_stock_threshold integer;
alter table public.stores add column if not exists default_tax_percent numeric(5, 2) not null default 0;
alter table public.stores add column if not exists default_track_inventory boolean not null default true;
-- How far ahead a batch counts as "expiring soon".
alter table public.stores add column if not exists expiry_alert_days integer not null default 30;
alter table public.stores add column if not exists template_applied text;
alter table public.stores add column if not exists template_applied_at timestamptz;

do $$ begin
  alter table public.stores
    add constraint stores_default_low_stock_nonneg check (default_low_stock_threshold is null or default_low_stock_threshold >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.stores
    add constraint stores_default_tax_range check (default_tax_percent between 0 and 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.stores
    add constraint stores_expiry_alert_days_range check (expiry_alert_days between 0 and 365);
exception when duplicate_object then null; end $$;

-- ── Categories: reorder and remove, atomically ──────────────────────────────

-- The new order is the whole list: a partial or foreign list is refused, so a
-- stale screen cannot scramble the order.
create or replace function public.reorder_categories(p_store_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid[];
begin
  select array_agg(id order by id) into v_existing from public.categories where store_id = p_store_id;
  if coalesce(v_existing, '{}') <> (select coalesce(array_agg(x order by x), '{}') from unnest(p_ids) x)
     or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'CATEGORY_SET_MISMATCH' using errcode = 'P0001';
  end if;

  update public.categories c
     set sort_order = o.position - 1
    from unnest(p_ids) with ordinality as o (id, position)
   where c.id = o.id and c.store_id = p_store_id;
end;
$$;

-- Removing a category that still holds products would silently uncategorise
-- them (MERCHANT_RULES C-5), so they must be moved somewhere first — another
-- category, or explicitly to "no category" (p_move_to null with p_force).
create or replace function public.delete_category(p_store_id uuid, p_category_id uuid, p_move_to uuid, p_uncategorise boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform 1 from public.categories where id = p_category_id and store_id = p_store_id for update;
  if not found then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_move_to is not null then
    if p_move_to = p_category_id or not exists (select 1 from public.categories where id = p_move_to and store_id = p_store_id) then
      raise exception 'TARGET_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  select count(*) into v_count from public.products where category_id = p_category_id and archived_at is null;
  if v_count > 0 and p_move_to is null and not coalesce(p_uncategorise, false) then
    raise exception 'CATEGORY_NOT_EMPTY:%', v_count using errcode = 'P0001';
  end if;

  update public.products set category_id = p_move_to where category_id = p_category_id;
  delete from public.categories where id = p_category_id;
  return v_count;
end;
$$;

revoke all on function public.reorder_categories(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.delete_category(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.reorder_categories(uuid, uuid[]) to service_role;
grant execute on function public.delete_category(uuid, uuid, uuid, boolean) to service_role;

-- ── Barcodes: one product per barcode within a store ────────────────────────
create unique index if not exists product_variants_store_barcode_key
  on public.product_variants (store_id, barcode) where barcode is not null;

-- ── Suppliers and purchases ─────────────────────────────────────────────────
create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id) on delete cascade,
  name        text not null,
  phone       text,
  email       citext,
  gstin       text,
  address     text,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint suppliers_name_len check (char_length(name) between 1 and 160),
  constraint suppliers_phone_format check (phone is null or phone ~ '^\+?[0-9]{7,15}$'),
  constraint suppliers_gstin_format check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  constraint suppliers_address_len check (address is null or char_length(address) <= 500),
  constraint suppliers_notes_len check (notes is null or char_length(notes) <= 500)
);

create index if not exists suppliers_store_id_idx on public.suppliers (store_id);
create unique index if not exists suppliers_store_name_key on public.suppliers (store_id, lower(name));

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();

create table if not exists public.purchases (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references public.stores (id) on delete cascade,
  supplier_id      uuid references public.suppliers (id) on delete set null,
  -- Snapshot, so the purchase reads the same if the supplier is renamed.
  supplier_name    text,
  invoice_number   text,
  invoice_date     date,
  purchase_date    date not null default current_date,
  status           text not null default 'draft',
  subtotal_paise   integer not null default 0,
  tax_paise        integer not null default 0,
  total_paise      integer not null default 0,
  notes            text,
  created_by       uuid references public.merchants (id) on delete set null,
  confirmed_by     uuid references public.merchants (id) on delete set null,
  confirmed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint purchases_status check (status in ('draft', 'confirmed', 'cancelled')),
  constraint purchases_money_nonneg check (subtotal_paise >= 0 and tax_paise >= 0 and total_paise >= 0),
  constraint purchases_total_adds_up check (total_paise = subtotal_paise + tax_paise),
  constraint purchases_invoice_len check (invoice_number is null or char_length(invoice_number) between 1 and 60),
  constraint purchases_notes_len check (notes is null or char_length(notes) <= 500),
  constraint purchases_confirmed_stamp check ((status = 'confirmed') = (confirmed_at is not null))
);

create index if not exists purchases_store_id_idx on public.purchases (store_id, purchase_date desc);
create index if not exists purchases_supplier_id_idx on public.purchases (supplier_id);
create index if not exists purchases_created_by_idx on public.purchases (created_by);
create index if not exists purchases_confirmed_by_idx on public.purchases (confirmed_by);
-- The same supplier invoice entered twice is a duplicate purchase.
create unique index if not exists purchases_supplier_invoice_key
  on public.purchases (store_id, supplier_id, lower(invoice_number))
  where invoice_number is not null and status <> 'cancelled';

drop trigger if exists purchases_set_updated_at on public.purchases;
create trigger purchases_set_updated_at before update on public.purchases
  for each row execute function public.set_updated_at();

create table if not exists public.purchase_items (
  id                uuid primary key default gen_random_uuid(),
  purchase_id       uuid not null references public.purchases (id) on delete cascade,
  product_id        uuid not null references public.products (id) on delete cascade,
  variant_id        uuid not null references public.product_variants (id) on delete cascade,
  product_name      text not null,
  variant_name      text,
  quantity          integer not null,
  unit_cost_paise   integer not null,
  tax_paise         integer not null default 0,
  line_total_paise  integer not null,
  batch_number      text,
  manufactured_on   date,
  expires_on        date,
  created_at        timestamptz not null default now(),

  constraint purchase_items_quantity_positive check (quantity > 0 and quantity <= 100000),
  constraint purchase_items_cost_nonneg check (unit_cost_paise >= 0 and tax_paise >= 0),
  constraint purchase_items_total_matches check (line_total_paise = unit_cost_paise * quantity + tax_paise),
  constraint purchase_items_batch_len check (batch_number is null or char_length(batch_number) between 1 and 60),
  constraint purchase_items_dates check (expires_on is null or manufactured_on is null or expires_on >= manufactured_on)
);

create index if not exists purchase_items_purchase_id_idx on public.purchase_items (purchase_id);
create index if not exists purchase_items_product_id_idx on public.purchase_items (product_id);
create index if not exists purchase_items_variant_id_idx on public.purchase_items (variant_id);

-- ── Batches ─────────────────────────────────────────────────────────────────
-- A lot of one variant, with its expiry. What is left of it goes down as stock
-- leaves the shelf (the trigger below), first-expiring first. Batched stock
-- never exceeds what is on the shelf; stock received without a batch is simply
-- not batched.
create table if not exists public.inventory_batches (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null references public.stores (id) on delete cascade,
  product_id          uuid not null references public.products (id) on delete cascade,
  variant_id          uuid not null references public.product_variants (id) on delete cascade,
  purchase_item_id    uuid references public.purchase_items (id) on delete set null,
  batch_number        text,
  manufactured_on     date,
  expires_on          date,
  quantity_received   integer not null,
  quantity_remaining  integer not null,
  unit_cost_paise     integer,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint inventory_batches_received_positive check (quantity_received > 0),
  constraint inventory_batches_remaining_range check (quantity_remaining between 0 and quantity_received),
  constraint inventory_batches_cost_nonneg check (unit_cost_paise is null or unit_cost_paise >= 0),
  constraint inventory_batches_batch_len check (batch_number is null or char_length(batch_number) between 1 and 60),
  constraint inventory_batches_dates check (expires_on is null or manufactured_on is null or expires_on >= manufactured_on)
);

create index if not exists inventory_batches_store_id_idx on public.inventory_batches (store_id, expires_on);
create index if not exists inventory_batches_product_id_idx on public.inventory_batches (product_id);
create index if not exists inventory_batches_variant_id_idx on public.inventory_batches (variant_id, expires_on);
create index if not exists inventory_batches_purchase_item_id_idx on public.inventory_batches (purchase_item_id);
create index if not exists inventory_batches_open_idx on public.inventory_batches (store_id, expires_on) where quantity_remaining > 0;

drop trigger if exists inventory_batches_set_updated_at on public.inventory_batches;
create trigger inventory_batches_set_updated_at before update on public.inventory_batches
  for each row execute function public.set_updated_at();

alter table public.inventory_ledger
  add column if not exists batch_id uuid references public.inventory_batches (id) on delete no action;
create index if not exists inventory_ledger_batch_id_idx on public.inventory_ledger (batch_id);

alter table public.suppliers enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.inventory_batches enable row level security;

drop policy if exists suppliers_select_owner on public.suppliers;
create policy suppliers_select_owner on public.suppliers for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));
drop policy if exists purchases_select_owner on public.purchases;
create policy purchases_select_owner on public.purchases for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));
drop policy if exists purchase_items_select_owner on public.purchase_items;
create policy purchase_items_select_owner on public.purchase_items for select to authenticated
  using (exists (select 1 from public.purchases p join public.stores s on s.id = p.store_id
                  where p.id = purchase_id and s.owner_id = (select auth.uid())));
drop policy if exists inventory_batches_select_owner on public.inventory_batches;
create policy inventory_batches_select_owner on public.inventory_batches for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));

-- ── Stock leaving the shelf leaves its batches too (FEFO) ───────────────────
-- A movement that names a batch takes from it first. Otherwise unexpired
-- batches go earliest-expiry first, then expired ones — except a write-off for
-- expiry, which takes the expired ones first. Stock beyond what is batched is
-- unbatched stock, and nothing is taken from batches for it.
create or replace function public.consume_batches()
returns trigger
language plpgsql
as $$
declare
  v_need   integer := -new.on_hand_change;
  v_take   integer;
  v_today  date;
  v_batch  record;
begin
  select (now() at time zone s.timezone)::date into v_today from public.stores s where s.id = new.store_id;

  if new.batch_id is not null then
    select quantity_remaining into v_take from public.inventory_batches where id = new.batch_id for update;
    v_take := least(coalesce(v_take, 0), v_need);
    update public.inventory_batches set quantity_remaining = quantity_remaining - v_take where id = new.batch_id;
    v_need := v_need - v_take;
  end if;

  for v_batch in
    select id, quantity_remaining, expires_on
      from public.inventory_batches
     where variant_id = new.variant_id and quantity_remaining > 0
     order by
       case when new.reason = 'expired'
            then (case when expires_on is not null and expires_on < v_today then 0 else 1 end)
            else (case when expires_on is not null and expires_on < v_today then 1 else 0 end) end,
       expires_on nulls last, created_at
       for update
  loop
    exit when v_need <= 0;
    v_take := least(v_batch.quantity_remaining, v_need);
    update public.inventory_batches set quantity_remaining = quantity_remaining - v_take where id = v_batch.id;
    v_need := v_need - v_take;
  end loop;

  return null;
end;
$$;

drop trigger if exists inventory_ledger_consume_batches on public.inventory_ledger;
create trigger inventory_ledger_consume_batches
  after insert on public.inventory_ledger
  for each row
  when (new.on_hand_change < 0)
  execute function public.consume_batches();

-- ── Merchant stock movements, now batch-aware ───────────────────────────────
-- Same contract as 0032, plus: a stock_in may open a batch (batch_number,
-- manufactured_on, expires_on), and a stock_out may name the batch it takes
-- from (batch_id) — the expired lot being written off, say. Also raises
-- BATCH_NOT_FOUND.
create or replace function public.record_stock_movement(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id   uuid := (payload ->> 'store_id')::uuid;
  v_variant_id uuid := (payload ->> 'variant_id')::uuid;
  v_kind       inventory_movement := (payload ->> 'kind')::inventory_movement;
  v_quantity   integer := (payload ->> 'quantity')::integer;
  v_batch_id   uuid := nullif(payload ->> 'batch_id', '')::uuid;
  v_product_id uuid;
  v_tracked    boolean;
  v_on_hand    integer;
  v_reserved   integer;
  v_change     integer;
  v_ledger_id  uuid;
begin
  if v_kind not in ('stock_in', 'stock_out', 'adjustment') then
    raise exception 'UNKNOWN_MOVEMENT' using errcode = 'P0001';
  end if;

  select v.product_id, p.track_inventory, v.quantity_on_hand, v.reserved_quantity
    into v_product_id, v_tracked, v_on_hand, v_reserved
    from public.product_variants v
    join public.products p on p.id = v.product_id
   where v.id = v_variant_id
     and p.store_id = v_store_id
     for update of v;

  if not found then
    raise exception 'VARIANT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not v_tracked then
    raise exception 'NOT_TRACKED' using errcode = 'P0001';
  end if;

  if v_batch_id is not null and not exists (
    select 1 from public.inventory_batches where id = v_batch_id and variant_id = v_variant_id
  ) then
    raise exception 'BATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_kind = 'stock_in' then
    v_change := v_quantity;
    if nullif(payload ->> 'batch_number', '') is not null or nullif(payload ->> 'expires_on', '') is not null then
      insert into public.inventory_batches (
        store_id, product_id, variant_id, batch_number, manufactured_on, expires_on,
        quantity_received, quantity_remaining, unit_cost_paise
      ) values (
        v_store_id, v_product_id, v_variant_id,
        nullif(payload ->> 'batch_number', ''),
        nullif(payload ->> 'manufactured_on', '')::date,
        nullif(payload ->> 'expires_on', '')::date,
        v_quantity, v_quantity, (payload ->> 'unit_cost_paise')::integer
      )
      returning id into v_batch_id;
    end if;
  elsif v_kind = 'stock_out' then
    if v_quantity > v_on_hand - v_reserved then
      raise exception 'INSUFFICIENT_STOCK:%', v_on_hand - v_reserved using errcode = 'P0001';
    end if;
    v_change := -v_quantity;
  else
    if (payload ->> 'new_quantity')::integer < v_reserved then
      raise exception 'BELOW_RESERVED:%', v_reserved using errcode = 'P0001';
    end if;
    v_change := (payload ->> 'new_quantity')::integer - v_on_hand;
    if v_change = 0 then
      raise exception 'NO_CHANGE' using errcode = 'P0001';
    end if;
  end if;

  update public.product_variants
     set quantity_on_hand = quantity_on_hand + v_change
   where id = v_variant_id
   returning quantity_on_hand, reserved_quantity into v_on_hand, v_reserved;

  insert into public.inventory_ledger (
    store_id, product_id, variant_id, movement_type,
    on_hand_change, reserved_change, on_hand_after, reserved_after,
    unit_cost_paise, reason, notes, performed_by_type, performed_by_id, batch_id
  ) values (
    v_store_id, v_product_id, v_variant_id, v_kind,
    v_change, 0, v_on_hand, v_reserved,
    (payload ->> 'unit_cost_paise')::integer,
    nullif(payload ->> 'reason', ''),
    nullif(payload ->> 'notes', ''),
    'merchant', (payload ->> 'merchant_id')::uuid, v_batch_id
  )
  returning id into v_ledger_id;

  return jsonb_build_object('ledger_id', v_ledger_id, 'batch_id', v_batch_id);
end;
$$;

revoke all on function public.record_stock_movement(jsonb) from public, anon, authenticated;
grant execute on function public.record_stock_movement(jsonb) to service_role;

-- ── Confirming a purchase ───────────────────────────────────────────────────
-- A draft purchase becomes stock: every line goes on the shelf as a
-- 'purchase' movement referencing the purchase, carrying its unit cost, and
-- opening a batch when it has a batch number or an expiry date. The variant's
-- cost becomes the latest purchase cost. All or nothing, under the variants'
-- row locks (variant order, as everywhere else). Confirming twice is a no-op.
-- Raises PURCHASE_NOT_FOUND, PURCHASE_EMPTY, PURCHASE_CANCELLED,
-- NOT_TRACKED:<product name>.
create or replace function public.confirm_purchase(p_store_id uuid, p_purchase_id uuid, p_merchant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase record;
  v_item     record;
  v_tracked  boolean;
  v_on_hand  integer;
  v_reserved integer;
  v_batch_id uuid;
  v_lines    integer := 0;
begin
  select * into v_purchase from public.purchases where id = p_purchase_id and store_id = p_store_id for update;
  if not found then
    raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_purchase.status = 'confirmed' then
    return jsonb_build_object('purchase_id', p_purchase_id, 'replayed', true);
  end if;
  if v_purchase.status = 'cancelled' then
    raise exception 'PURCHASE_CANCELLED' using errcode = 'P0001';
  end if;

  for v_item in
    select * from public.purchase_items where purchase_id = p_purchase_id order by variant_id
  loop
    v_lines := v_lines + 1;

    select p.track_inventory into v_tracked
      from public.product_variants v join public.products p on p.id = v.product_id
     where v.id = v_item.variant_id and p.store_id = p_store_id
       for update of v;
    if not found then
      raise exception 'VARIANT_NOT_FOUND' using errcode = 'P0002';
    end if;
    if not v_tracked then
      raise exception 'NOT_TRACKED:%', v_item.product_name using errcode = 'P0001';
    end if;

    v_batch_id := null;
    if v_item.batch_number is not null or v_item.expires_on is not null then
      insert into public.inventory_batches (
        store_id, product_id, variant_id, purchase_item_id, batch_number, manufactured_on, expires_on,
        quantity_received, quantity_remaining, unit_cost_paise
      ) values (
        p_store_id, v_item.product_id, v_item.variant_id, v_item.id, v_item.batch_number,
        v_item.manufactured_on, v_item.expires_on, v_item.quantity, v_item.quantity, v_item.unit_cost_paise
      )
      returning id into v_batch_id;
    end if;

    update public.product_variants
       set quantity_on_hand = quantity_on_hand + v_item.quantity,
           cost_paise = v_item.unit_cost_paise
     where id = v_item.variant_id
     returning quantity_on_hand, reserved_quantity into v_on_hand, v_reserved;

    insert into public.inventory_ledger (
      store_id, product_id, variant_id, movement_type,
      on_hand_change, reserved_change, on_hand_after, reserved_after,
      unit_cost_paise, reference_type, reference_id, performed_by_type, performed_by_id, batch_id,
      notes
    ) values (
      p_store_id, v_item.product_id, v_item.variant_id, 'purchase',
      v_item.quantity, 0, v_on_hand, v_reserved,
      v_item.unit_cost_paise, 'purchase', p_purchase_id, 'merchant', p_merchant_id, v_batch_id,
      left(coalesce('Invoice ' || v_purchase.invoice_number, 'Purchase'), 500)
    );
  end loop;

  if v_lines = 0 then
    raise exception 'PURCHASE_EMPTY' using errcode = 'P0001';
  end if;

  update public.purchases
     set status = 'confirmed', confirmed_at = now(), confirmed_by = p_merchant_id
   where id = p_purchase_id;

  return jsonb_build_object('purchase_id', p_purchase_id, 'replayed', false, 'lines', v_lines);
end;
$$;

revoke all on function public.confirm_purchase(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_purchase(uuid, uuid, uuid) to service_role;

-- Saving a draft replaces its lines in one transaction and recomputes totals.
-- payload: { store_id, purchase_id?, merchant_id, supplier_id, supplier_name,
--   invoice_number, invoice_date, purchase_date, notes, items: [{ variant_id,
--   quantity, unit_cost_paise, tax_paise, batch_number, manufactured_on,
--   expires_on }] }
-- Raises PURCHASE_NOT_FOUND, PURCHASE_NOT_DRAFT, VARIANT_NOT_FOUND, SUPPLIER_NOT_FOUND.
create or replace function public.save_purchase(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id    uuid := (payload ->> 'store_id')::uuid;
  v_purchase_id uuid := nullif(payload ->> 'purchase_id', '')::uuid;
  v_supplier_id uuid := nullif(payload ->> 'supplier_id', '')::uuid;
  v_status      text;
  v_item        jsonb;
  v_variant     record;
  v_subtotal    integer := 0;
  v_tax         integer := 0;
  v_line_tax    integer;
  v_line_sub    integer;
begin
  if v_supplier_id is not null and not exists (
    select 1 from public.suppliers where id = v_supplier_id and store_id = v_store_id
  ) then
    raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_purchase_id is null then
    insert into public.purchases (store_id, created_by, status)
    values (v_store_id, (payload ->> 'merchant_id')::uuid, 'draft')
    returning id into v_purchase_id;
  else
    select status into v_status from public.purchases where id = v_purchase_id and store_id = v_store_id for update;
    if not found then
      raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_status <> 'draft' then
      raise exception 'PURCHASE_NOT_DRAFT' using errcode = 'P0001';
    end if;
    delete from public.purchase_items where purchase_id = v_purchase_id;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(payload -> 'items', '[]'::jsonb))
  loop
    select v.id, v.product_id, v.name as variant_name, p.name as product_name
      into v_variant
      from public.product_variants v join public.products p on p.id = v.product_id
     where v.id = (v_item ->> 'variant_id')::uuid and p.store_id = v_store_id and p.archived_at is null;
    if not found then
      raise exception 'VARIANT_NOT_FOUND' using errcode = 'P0002';
    end if;

    v_line_sub := (v_item ->> 'unit_cost_paise')::integer * (v_item ->> 'quantity')::integer;
    v_line_tax := coalesce((v_item ->> 'tax_paise')::integer, 0);
    v_subtotal := v_subtotal + v_line_sub;
    v_tax := v_tax + v_line_tax;

    insert into public.purchase_items (
      purchase_id, product_id, variant_id, product_name, variant_name, quantity, unit_cost_paise,
      tax_paise, line_total_paise, batch_number, manufactured_on, expires_on
    ) values (
      v_purchase_id, v_variant.product_id, v_variant.id, v_variant.product_name, v_variant.variant_name,
      (v_item ->> 'quantity')::integer, (v_item ->> 'unit_cost_paise')::integer,
      v_line_tax, v_line_sub + v_line_tax,
      nullif(v_item ->> 'batch_number', ''),
      nullif(v_item ->> 'manufactured_on', '')::date,
      nullif(v_item ->> 'expires_on', '')::date
    );
  end loop;

  update public.purchases
     set supplier_id = v_supplier_id,
         supplier_name = coalesce(
           (select name from public.suppliers where id = v_supplier_id),
           nullif(payload ->> 'supplier_name', '')
         ),
         invoice_number = nullif(payload ->> 'invoice_number', ''),
         invoice_date = nullif(payload ->> 'invoice_date', '')::date,
         purchase_date = coalesce(nullif(payload ->> 'purchase_date', '')::date, purchase_date),
         notes = nullif(payload ->> 'notes', ''),
         subtotal_paise = v_subtotal,
         tax_paise = v_tax,
         total_paise = v_subtotal + v_tax
   where id = v_purchase_id;

  return v_purchase_id;
end;
$$;

revoke all on function public.save_purchase(jsonb) from public, anon, authenticated;
grant execute on function public.save_purchase(jsonb) to service_role;

-- The ledger may now reference a purchase that has its own table.
-- (inventory_ledger_reference_type already allows 'purchase' since 0028.)
