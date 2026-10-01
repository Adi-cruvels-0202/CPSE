-- 0029_published_catalog_rls.sql — the public catalog now also requires the
-- merchant to have published the store, and a merchant can see their own
-- stores while they are still unpublished.
--
-- Replaces the catalog policies from 0018. Like 0018 this is defence in depth:
-- the API uses the service role and enforces the same rule in code.

-- Customers see a store only when the operator has not switched it off AND the
-- merchant has published it.
drop policy if exists stores_public_read on public.stores;
create policy stores_public_read on public.stores
  for select to anon, authenticated
  using (is_active and is_published);

drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories
  for select to anon, authenticated
  using (
    is_active
    and exists (select 1 from public.stores s
                 where s.id = store_id and s.is_active and s.is_published)
  );

drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon, authenticated
  using (exists (select 1 from public.stores s
                  where s.id = store_id and s.is_active and s.is_published));

drop policy if exists product_images_public_read on public.product_images;
create policy product_images_public_read on public.product_images
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.products p
        join public.stores s on s.id = p.store_id
       where p.id = product_id and s.is_active and s.is_published
    )
  );

drop policy if exists product_variants_public_read on public.product_variants;
create policy product_variants_public_read on public.product_variants
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.products p
        join public.stores s on s.id = p.store_id
       where p.id = product_id and s.is_active and s.is_published
    )
  );

-- The owner sees their own stores in any state, including unpublished.
drop policy if exists stores_select_owner on public.stores;
create policy stores_select_owner on public.stores
  for select to authenticated
  using (owner_id = (select auth.uid()));
