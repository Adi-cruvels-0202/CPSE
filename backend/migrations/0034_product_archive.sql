-- 0034_product_archive.sql — a merchant can delete a product.
-- MERCHANT_RULES P-8 (revised): "delete" archives.
--
-- A product cannot simply be removed: its stock history refers to it
-- (inventory_ledger, on delete restrict), and past orders and counter sales
-- would lose the link to what was bought. So deleting stamps archived_at. An
-- archived product is gone from the merchant's lists, the storefront and the
-- till; the rows that refer to it keep pointing at it.

alter table public.products
  add column if not exists archived_at timestamptz;

-- The name of an archived product is free again: "Toor Dal" can be deleted
-- and added back.
drop index if exists public.products_store_slug_key;
create unique index if not exists products_store_slug_key
  on public.products (store_id, slug)
  where archived_at is null;

-- Customers reading the catalogue directly never see an archived product.
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon, authenticated
  using (
    archived_at is null
    and exists (select 1 from public.stores s
                 where s.id = store_id and s.is_active and s.is_published)
  );
