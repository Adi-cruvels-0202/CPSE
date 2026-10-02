-- 0033_p1_holidays_sales_storage.sql — the P1 merchant features: store
-- holidays, counter (POS) sales, and the storage bucket for photos.
-- WORK_PLAN Day 6; MERCHANT_API.md, P1 endpoints; MERCHANT_RULES §2, §8.

-- ── Store holidays ──────────────────────────────────────────────────────────
-- A date the store is closed, whatever its weekly hours say. Merchant-One
-- stored these and nothing read them (MERCHANT_RULES S-12); here the open/closed
-- resolver does.
create table if not exists public.store_holidays (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores (id) on delete cascade,
  -- A calendar date in the store's own timezone.
  holiday_date  date not null,
  reason        text,
  created_at    timestamptz not null default now(),

  constraint store_holidays_reason_len check (reason is null or char_length(reason) between 1 and 200)
);

-- One entry per date; also the lookup the store page makes.
create unique index if not exists store_holidays_store_date_key
  on public.store_holidays (store_id, holiday_date);

alter table public.store_holidays enable row level security;

drop policy if exists store_holidays_select_owner on public.store_holidays;
create policy store_holidays_select_owner on public.store_holidays
  for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));

-- ── Counter sales (POS) ─────────────────────────────────────────────────────
-- A walk-in sale at the counter: no customer account, no delivery, paid on the
-- spot (MERGE_MAPPING §4.3 — walk-ins are sales, not orders). Priced by the same
-- engine as an order, tax per line on top (D-4), and it sells only what is
-- available, so it never takes stock an online order holds (MERCHANT_RULES X-6).

-- Invoice numbers count up per store, under the store row's lock — not
-- "max + 1", which two sales at once would both compute (MERCHANT_RULES X-8).
alter table public.stores
  add column if not exists next_invoice_number integer not null default 1;

do $$ begin
  alter table public.stores
    add constraint stores_next_invoice_positive check (next_invoice_number >= 1);
exception when duplicate_object then null; end $$;

create table if not exists public.sales (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references public.stores (id) on delete restrict,
  invoice_number   text not null,
  -- Duplicate-submission guard, per store: a retried "Charge" button returns
  -- the first sale instead of selling twice (MERCHANT_RULES X-2).
  idempotency_key  text,
  payment_method   text not null,
  customer_name    text,
  customer_phone   text,
  notes            text,

  subtotal_paise   integer not null,
  discount_paise   integer not null default 0,
  tax_paise        integer not null default 0,
  total_paise      integer not null,

  performed_by     uuid references public.merchants (id) on delete set null,
  created_at       timestamptz not null default now(),

  constraint sales_payment_method   check (payment_method in ('cash', 'upi', 'card', 'other')),
  constraint sales_subtotal_nonneg  check (subtotal_paise >= 0),
  constraint sales_discount_nonneg  check (discount_paise >= 0),
  constraint sales_tax_nonneg       check (tax_paise >= 0),
  -- MERCHANT_RULES X-4: a discount larger than the bill is refused, never
  -- quietly turned into a free sale.
  constraint sales_total_nonneg     check (total_paise >= 0),
  constraint sales_total_adds_up    check (total_paise = subtotal_paise - discount_paise + tax_paise),
  constraint sales_customer_name_len  check (customer_name is null or char_length(customer_name) between 1 and 120),
  constraint sales_customer_phone_format check (customer_phone is null or customer_phone ~ '^\+?[0-9]{7,15}$'),
  constraint sales_notes_len        check (notes is null or char_length(notes) <= 500)
);

create unique index if not exists sales_store_invoice_key on public.sales (store_id, invoice_number);
create unique index if not exists sales_store_idempotency_key
  on public.sales (store_id, idempotency_key) where idempotency_key is not null;
create index if not exists sales_store_id_idx on public.sales (store_id, created_at desc);
create index if not exists sales_performed_by_idx on public.sales (performed_by);

create table if not exists public.sale_items (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references public.sales (id) on delete cascade,
  product_id        uuid references public.products (id) on delete set null,
  variant_id        uuid references public.product_variants (id) on delete set null,

  -- Snapshot at sale time, like an order line (D11).
  product_name      text not null,
  variant_name      text,
  sku               text,
  quantity          integer not null,
  unit_price_paise  integer not null,
  tax_percent       numeric(5, 2) not null default 0,
  tax_paise         integer not null default 0,
  line_total_paise  integer not null,

  created_at        timestamptz not null default now(),

  constraint sale_items_quantity_positive check (quantity > 0),
  constraint sale_items_unit_price_nonneg check (unit_price_paise >= 0),
  constraint sale_items_tax_percent_range check (tax_percent between 0 and 100),
  constraint sale_items_tax_nonneg        check (tax_paise >= 0),
  constraint sale_items_line_total_matches check (line_total_paise = unit_price_paise * quantity + tax_paise)
);

create index if not exists sale_items_sale_id_idx    on public.sale_items (sale_id);
create index if not exists sale_items_product_id_idx on public.sale_items (product_id);
create index if not exists sale_items_variant_id_idx on public.sale_items (variant_id);

alter table public.sales      enable row level security;
alter table public.sale_items enable row level security;

drop policy if exists sales_select_owner on public.sales;
create policy sales_select_owner on public.sales
  for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));

drop policy if exists sale_items_select_owner on public.sale_items;
create policy sale_items_select_owner on public.sale_items
  for select to authenticated
  using (
    exists (
      select 1 from public.sales sa
        join public.stores s on s.id = sa.store_id
       where sa.id = sale_id and s.owner_id = (select auth.uid())
    )
  );

-- The sale, its lines, the stock and the ledger, in one transaction.
--
-- The API prices the basket with the shared engine and passes the result in,
-- exactly as for create_order; this re-checks stock under the variants' row
-- locks, which is what stops a counter sale and an online order both taking the
-- last unit.
--
-- payload: { store_id, merchant_id, idempotency_key, payment_method,
--   customer_name, customer_phone, notes, subtotal_paise, discount_paise,
--   tax_paise, total_paise, items: [{ product_id, variant_id, product_name,
--   variant_name, sku, quantity, unit_price_paise, tax_percent, tax_paise,
--   line_total_paise }] }
-- Returns { sale_id, replayed }. Raises 'INSUFFICIENT_STOCK:<name>:<available>'
-- or 'VARIANT_NOT_FOUND'.
create or replace function public.create_sale(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id   uuid := (payload ->> 'store_id')::uuid;
  v_key        text := nullif(payload ->> 'idempotency_key', '');
  v_sale_id    uuid;
  v_invoice    integer;
  v_item       jsonb;
  v_variant_id uuid;
  v_quantity   integer;
  v_product_id uuid;
  v_tracked    boolean;
  v_on_hand    integer;
  v_reserved   integer;
begin
  if v_key is not null then
    select id into v_sale_id from public.sales where store_id = v_store_id and idempotency_key = v_key;
    if found then
      return jsonb_build_object('sale_id', v_sale_id, 'replayed', true);
    end if;
  end if;

  update public.stores
     set next_invoice_number = next_invoice_number + 1
   where id = v_store_id
   returning next_invoice_number - 1 into v_invoice;

  insert into public.sales (
    store_id, invoice_number, idempotency_key, payment_method,
    customer_name, customer_phone, notes,
    subtotal_paise, discount_paise, tax_paise, total_paise, performed_by
  ) values (
    v_store_id,
    'INV-' || lpad(v_invoice::text, 6, '0'),
    v_key,
    payload ->> 'payment_method',
    nullif(payload ->> 'customer_name', ''),
    nullif(payload ->> 'customer_phone', ''),
    nullif(payload ->> 'notes', ''),
    (payload ->> 'subtotal_paise')::integer,
    (payload ->> 'discount_paise')::integer,
    (payload ->> 'tax_paise')::integer,
    (payload ->> 'total_paise')::integer,
    (payload ->> 'merchant_id')::uuid
  )
  returning id into v_sale_id;

  -- Variant order, so two sales sharing variants lock them in the same order.
  for v_item in
    select value from jsonb_array_elements(payload -> 'items') order by value ->> 'variant_id'
  loop
    v_variant_id := (v_item ->> 'variant_id')::uuid;
    v_quantity   := (v_item ->> 'quantity')::integer;

    select v.product_id, p.track_inventory, v.quantity_on_hand, v.reserved_quantity
      into v_product_id, v_tracked, v_on_hand, v_reserved
      from public.product_variants v
      join public.products p on p.id = v.product_id
     where v.id = v_variant_id and p.store_id = v_store_id
       for update of v;

    if not found then
      raise exception 'VARIANT_NOT_FOUND' using errcode = 'P0002';
    end if;

    if v_tracked and v_on_hand - v_reserved < v_quantity then
      raise exception 'INSUFFICIENT_STOCK:%:%', v_item ->> 'product_name', v_on_hand - v_reserved
        using errcode = 'P0001';
    end if;

    insert into public.sale_items (
      sale_id, product_id, variant_id, product_name, variant_name, sku,
      quantity, unit_price_paise, tax_percent, tax_paise, line_total_paise
    ) values (
      v_sale_id, v_product_id, v_variant_id,
      v_item ->> 'product_name',
      nullif(v_item ->> 'variant_name', ''),
      nullif(v_item ->> 'sku', ''),
      v_quantity,
      (v_item ->> 'unit_price_paise')::integer,
      coalesce((v_item ->> 'tax_percent')::numeric, 0),
      coalesce((v_item ->> 'tax_paise')::integer, 0),
      (v_item ->> 'line_total_paise')::integer
    );

    if v_tracked then
      update public.product_variants
         set quantity_on_hand = quantity_on_hand - v_quantity
       where id = v_variant_id
       returning quantity_on_hand, reserved_quantity into v_on_hand, v_reserved;

      insert into public.inventory_ledger (
        store_id, product_id, variant_id, movement_type,
        on_hand_change, reserved_change, on_hand_after, reserved_after,
        reference_type, reference_id, performed_by_type, performed_by_id
      ) values (
        v_store_id, v_product_id, v_variant_id, 'sale',
        -v_quantity, 0, v_on_hand, v_reserved,
        'sale', v_sale_id, 'merchant', (payload ->> 'merchant_id')::uuid
      );
    end if;
  end loop;

  return jsonb_build_object('sale_id', v_sale_id, 'replayed', false);
end;
$$;

revoke all on function public.create_sale(jsonb) from public, anon, authenticated;
grant execute on function public.create_sale(jsonb) to service_role;

-- ── Photo storage ───────────────────────────────────────────────────────────
-- D-10: logos, covers and product photos live in Supabase Storage, not on the
-- server's disk. One public bucket: anyone may read a photo (a store page is
-- public), and only the API's service-role key may write, because there are no
-- write policies at all. The size and type limits are enforced by Storage too,
-- behind the API's own checks.
--
-- Guarded, so these migrations still run on a plain Postgres with no storage
-- schema (the test database).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('catalogue', 'catalogue', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
      set public = excluded.public,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
