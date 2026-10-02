-- 0031_catalogue_functions.sql — the merchant catalogue's multi-row writes,
-- each in one transaction, and variant cost hidden from the public roles.
-- MERCHANT_API.md, Products and variants; MERCHANT_RULES §4.
--
-- The API reaches Postgres only through PostgREST (D34), which cannot wrap
-- several statements in a transaction. Creating a product writes the product,
-- its variants, their opening stock and its images; doing that in five calls
-- would leave a product with no variants, or stock with no ledger row, the
-- first time a request died halfway. So, like create_order, these are SQL.

-- ── Variants, with their opening stock ──────────────────────────────────────
-- Adds variants to an existing product. Opening stock goes on the shelf AND
-- into the ledger as a stock_in, so it is never a number with no history
-- (D-5: stock moves only through movements that are logged).
--
-- payload: { store_id, product_id, merchant_id, variants: [{ name, sku,
--   barcode, weight_grams, price_paise, mrp_paise, cost_paise,
--   opening_quantity }] }
-- Returns the new variant ids, in the order given.
create or replace function public.add_product_variants(payload jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id    uuid := (payload ->> 'store_id')::uuid;
  v_product_id  uuid := (payload ->> 'product_id')::uuid;
  v_merchant_id uuid := (payload ->> 'merchant_id')::uuid;
  v_tracked     boolean;
  v_next_sort   integer;
  v_variant     jsonb;
  v_variant_id  uuid;
  v_opening     integer;
  v_ids         uuid[] := '{}';
begin
  -- The product must be in the store the caller owns; the API has checked
  -- ownership of the store, this checks the product belongs to it.
  select track_inventory into v_tracked
    from public.products
   where id = v_product_id and store_id = v_store_id
     for update;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next_sort
    from public.product_variants where product_id = v_product_id;

  for v_variant in select value from jsonb_array_elements(payload -> 'variants')
  loop
    v_opening := coalesce((v_variant ->> 'opening_quantity')::integer, 0);

    insert into public.product_variants (
      product_id, name, sku, barcode, weight_grams,
      price_paise, mrp_paise, cost_paise, quantity_on_hand, sort_order
    ) values (
      v_product_id,
      v_variant ->> 'name',
      nullif(v_variant ->> 'sku', ''),
      nullif(v_variant ->> 'barcode', ''),
      (v_variant ->> 'weight_grams')::integer,
      (v_variant ->> 'price_paise')::integer,
      (v_variant ->> 'mrp_paise')::integer,
      (v_variant ->> 'cost_paise')::integer,
      case when v_tracked then v_opening else 0 end,
      v_next_sort
    )
    returning id into v_variant_id;

    if v_tracked and v_opening > 0 then
      insert into public.inventory_ledger (
        store_id, product_id, variant_id, movement_type,
        on_hand_change, reserved_change, on_hand_after, reserved_after,
        unit_cost_paise, reason, performed_by_type, performed_by_id
      ) values (
        v_store_id, v_product_id, v_variant_id, 'stock_in',
        v_opening, 0, v_opening, 0,
        (v_variant ->> 'cost_paise')::integer, 'Opening stock', 'merchant', v_merchant_id
      );
    end if;

    v_ids := v_ids || v_variant_id;
    v_next_sort := v_next_sort + 1;
  end loop;

  return v_ids;
end;
$$;

-- ── Images: the list is replaced, never patched ─────────────────────────────
-- payload: { product_id, images: [{ url, alt_text }] } — order is sort order.
create or replace function public.replace_product_images(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid := (payload ->> 'product_id')::uuid;
begin
  delete from public.product_images where product_id = v_product_id;

  insert into public.product_images (product_id, url, alt_text, sort_order)
  select v_product_id,
         image ->> 'url',
         nullif(image ->> 'alt_text', ''),
         (ordinality - 1)::integer
    from jsonb_array_elements(coalesce(payload -> 'images', '[]'::jsonb)) with ordinality as images (image, ordinality);
end;
$$;

-- ── A product, all at once ──────────────────────────────────────────────────
-- payload: { store_id, merchant_id, name, slug, description, category_id, unit,
--   tax_percent, track_inventory, low_stock_threshold, images: [...],
--   variants: [...] }  — variants and images as above.
-- Returns the new product id.
create or replace function public.create_product(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_cheapest   jsonb;
begin
  -- The product row needs a price before its variants exist; it starts at the
  -- cheapest one's, and sync_product_price (0030) keeps it there afterwards.
  select value into v_cheapest
    from jsonb_array_elements(payload -> 'variants')
   order by (value ->> 'price_paise')::integer
   limit 1;

  insert into public.products (
    store_id, category_id, name, slug, description,
    price_paise, mrp_paise, tax_percent, unit, track_inventory, low_stock_threshold
  ) values (
    (payload ->> 'store_id')::uuid,
    nullif(payload ->> 'category_id', '')::uuid,
    payload ->> 'name',
    payload ->> 'slug',
    nullif(payload ->> 'description', ''),
    (v_cheapest ->> 'price_paise')::integer,
    (v_cheapest ->> 'mrp_paise')::integer,
    coalesce((payload ->> 'tax_percent')::numeric, 0),
    coalesce((payload ->> 'unit')::product_unit, 'pcs'),
    coalesce((payload ->> 'track_inventory')::boolean, true),
    (payload ->> 'low_stock_threshold')::integer
  )
  returning id into v_product_id;

  perform public.add_product_variants(jsonb_build_object(
    'store_id', payload -> 'store_id',
    'product_id', v_product_id,
    'merchant_id', payload -> 'merchant_id',
    'variants', payload -> 'variants'
  ));

  perform public.replace_product_images(jsonb_build_object(
    'product_id', v_product_id,
    'images', coalesce(payload -> 'images', '[]'::jsonb)
  ));

  return v_product_id;
end;
$$;

-- Only the API's service-role connection may call these (the 0023 lesson:
-- name anon and authenticated explicitly).
revoke all on function public.add_product_variants(jsonb) from public, anon, authenticated;
revoke all on function public.replace_product_images(jsonb) from public, anon, authenticated;
revoke all on function public.create_product(jsonb) from public, anon, authenticated;
grant execute on function public.add_product_variants(jsonb) to service_role;
grant execute on function public.replace_product_images(jsonb) to service_role;
grant execute on function public.create_product(jsonb) to service_role;

-- ── What the merchant paid stays the merchant's business ────────────────────
-- MERCHANT_RULES P-11. The catalog is world-readable through RLS (0018, 0029),
-- and RLS is per row, not per column — so anyone holding the public anon key
-- could read cost_paise straight from the table. The API never returns it to
-- customers; this closes the direct route too: the public roles may read every
-- variant column except cost.
revoke select on public.product_variants from anon, authenticated;
grant select (
  id, product_id, store_id, name, sku, barcode, weight_grams,
  price_paise, mrp_paise, quantity_on_hand, reserved_quantity, version,
  is_available, sort_order, created_at, updated_at
) on public.product_variants to anon, authenticated;
