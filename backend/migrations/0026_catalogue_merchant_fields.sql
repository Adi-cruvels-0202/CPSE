-- 0026_catalogue_merchant_fields.sql — categories, products and variants gain
-- what the merchant side manages. MERGE_MAPPING §4.2, MERCHANT_RULES §3–§5.
--
-- Additive only. The customer side still reads products.stock and
-- product_variants.stock; moving it onto quantity_on_hand / reserved_quantity,
-- and giving every product a default variant (D-6), happen in the next
-- migration together with the create_order change that depends on them —
-- doing either here would change what customers can buy before the code that
-- understands it ships.

do $$ begin
  create type product_unit as enum (
    'pcs', 'kg', 'g', 'l', 'ml', 'm', 'cm', 'dozen',
    'pack', 'box', 'pair', 'set', 'roll', 'plate', 'serving'
  );
exception when duplicate_object then null; end $$;

-- ── Categories ──────────────────────────────────────────────────────────────

alter table public.categories
  add column if not exists description text;

do $$ begin
  alter table public.categories
    add constraint categories_description_len
    check (description is null or char_length(description) <= 500);
exception when duplicate_object then null; end $$;

-- MERCHANT_RULES C-2: one name per store, ignoring case — Merchant-One let
-- "Dairy" and "dairy" sit side by side.
create unique index if not exists categories_store_name_key
  on public.categories (store_id, lower(name));

-- ── Products ────────────────────────────────────────────────────────────────

-- D-4: tax is added on top, per line, at this rate. 0 = no tax, which is what
-- every existing product charged.
alter table public.products
  add column if not exists tax_percent numeric(5, 2) not null default 0;
alter table public.products
  add column if not exists unit product_unit not null default 'pcs';
-- false = never counted, never sold out (MERCHANT_RULES P-6). Set from the
-- legacy `stock is null` convention by the stock migration, not here.
alter table public.products
  add column if not exists track_inventory boolean not null default true;
alter table public.products
  add column if not exists low_stock_threshold integer;

do $$ begin
  alter table public.products
    add constraint products_tax_percent_range check (tax_percent between 0 and 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.products
    add constraint products_low_stock_threshold_nonneg
    check (low_stock_threshold is null or low_stock_threshold >= 0);
exception when duplicate_object then null; end $$;

-- Target of the variants' composite foreign key below. `id` alone is already
-- unique; this exists so (product_id, store_id) can be referenced as a pair.
create unique index if not exists products_id_store_key on public.products (id, store_id);

-- ── Variants ────────────────────────────────────────────────────────────────

-- store_id is copied from the product so a SKU can be unique per store
-- (MERCHANT_RULES P-5) and the inventory screens can filter by store without a
-- join. The composite FK makes it impossible for the copy to disagree with the
-- product; the trigger fills it in so no writer has to.
alter table public.product_variants
  add column if not exists store_id uuid;

update public.product_variants v
   set store_id = p.store_id
  from public.products p
 where p.id = v.product_id
   and v.store_id is null;

alter table public.product_variants
  alter column store_id set not null;

do $$ begin
  alter table public.product_variants
    add constraint product_variants_product_store_fkey
    foreign key (product_id, store_id)
    references public.products (id, store_id)
    on delete cascade on update cascade;
exception when duplicate_object then null; end $$;

create index if not exists product_variants_store_id_idx on public.product_variants (store_id);

create or replace function public.set_variant_store_id()
returns trigger
language plpgsql
as $$
begin
  select store_id into new.store_id from public.products where id = new.product_id;
  return new;
end;
$$;

drop trigger if exists product_variants_set_store_id on public.product_variants;
create trigger product_variants_set_store_id
  before insert or update of product_id on public.product_variants
  for each row execute function public.set_variant_store_id();

alter table public.product_variants
  add column if not exists sku citext;
alter table public.product_variants
  add column if not exists barcode text;
alter table public.product_variants
  add column if not exists weight_grams integer;
alter table public.product_variants
  add column if not exists mrp_paise integer;
-- What the merchant paid. Merchant-only: never in a customer response
-- (MERCHANT_RULES P-11).
alter table public.product_variants
  add column if not exists cost_paise integer;

-- D-5. available = quantity_on_hand - reserved_quantity. Reserved is what open
-- orders hold; it can never exceed what is on the shelf.
alter table public.product_variants
  add column if not exists quantity_on_hand integer not null default 0;
alter table public.product_variants
  add column if not exists reserved_quantity integer not null default 0;
-- Optimistic lock for the merchant's edit screens. create_order keeps its row
-- locks; this guards a stale form overwriting a newer save.
alter table public.product_variants
  add column if not exists version integer not null default 0;

do $$ begin
  alter table public.product_variants
    add constraint product_variants_sku_len check (sku is null or char_length(sku) between 1 and 50);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.product_variants
    add constraint product_variants_barcode_len
    check (barcode is null or char_length(barcode) between 1 and 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.product_variants
    add constraint product_variants_weight_positive check (weight_grams is null or weight_grams > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.product_variants
    add constraint product_variants_mrp_nonneg check (mrp_paise is null or mrp_paise >= 0);
exception when duplicate_object then null; end $$;

-- Same rule as products_mrp_gte_price.
do $$ begin
  alter table public.product_variants
    add constraint product_variants_mrp_gte_price check (mrp_paise is null or mrp_paise >= price_paise);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.product_variants
    add constraint product_variants_cost_nonneg check (cost_paise is null or cost_paise >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.product_variants
    add constraint product_variants_on_hand_nonneg check (quantity_on_hand >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.product_variants
    add constraint product_variants_reserved_nonneg check (reserved_quantity >= 0);
exception when duplicate_object then null; end $$;

-- The last line of defence for MERCHANT_RULES I-2, I-3 and I-8: no stock-out,
-- count or completion can leave less on the shelf than open orders hold.
do $$ begin
  alter table public.product_variants
    add constraint product_variants_reserved_lte_on_hand check (reserved_quantity <= quantity_on_hand);
exception when duplicate_object then null; end $$;

-- MERCHANT_RULES P-5: unique per store, not globally — two shops may both use
-- MILK-500. citext makes it case-insensitive.
create unique index if not exists product_variants_store_sku_key
  on public.product_variants (store_id, sku) where sku is not null;
