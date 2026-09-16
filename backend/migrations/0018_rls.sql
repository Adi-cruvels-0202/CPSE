-- 0018_rls.sql — Row Level Security on every table. Checklist 1.19.
--
-- Defense-in-depth only (decision D5). The API talks to Postgres with the
-- service-role key, which BYPASSES RLS, so ownership is still enforced in
-- application code on every query. These policies are what protects the data if
-- an anon/authenticated key is ever used directly — for example by the frontend
-- reading a public store page, or by createUserClient() in src/lib/supabase.js.
--
-- Two shapes recur:
--   * public catalog (stores, categories, products, images, variants) — readable
--     by everyone including anon, because a shared store link must open without
--     a login. Writes are merchant-side and therefore denied to everyone here.
--   * customer-owned (everything else) — the owner, and nobody else.

-- ── Catalog: world-readable, nobody writes ──────────────────────────────────

alter table public.stores            enable row level security;
alter table public.categories        enable row level security;
alter table public.products          enable row level security;
alter table public.product_images    enable row level security;
alter table public.product_variants  enable row level security;

drop policy if exists stores_public_read on public.stores;
create policy stores_public_read on public.stores
  for select to anon, authenticated
  using (is_active);

drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories
  for select to anon, authenticated
  using (
    is_active
    and exists (select 1 from public.stores s where s.id = store_id and s.is_active)
  );

drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon, authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.is_active));

drop policy if exists product_images_public_read on public.product_images;
create policy product_images_public_read on public.product_images
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.products p
        join public.stores s on s.id = p.store_id
       where p.id = product_id and s.is_active
    )
  );

drop policy if exists product_variants_public_read on public.product_variants;
create policy product_variants_public_read on public.product_variants
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.products p
        join public.stores s on s.id = p.store_id
       where p.id = product_id and s.is_active
    )
  );

-- ── Customer profile ────────────────────────────────────────────────────────

alter table public.customers enable row level security;

drop policy if exists customers_select_own on public.customers;
create policy customers_select_own on public.customers
  for select to authenticated using (id = (select auth.uid()));

-- No insert policy: rows are created by the on_auth_user_created trigger.
drop policy if exists customers_update_own on public.customers;
create policy customers_update_own on public.customers
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ── Addresses ───────────────────────────────────────────────────────────────

alter table public.addresses enable row level security;

drop policy if exists addresses_all_own on public.addresses;
create policy addresses_all_own on public.addresses
  for all to authenticated
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));

-- ── Carts ───────────────────────────────────────────────────────────────────

alter table public.carts      enable row level security;
alter table public.cart_items enable row level security;

drop policy if exists carts_all_own on public.carts;
create policy carts_all_own on public.carts
  for all to authenticated
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));

drop policy if exists cart_items_all_own on public.cart_items;
create policy cart_items_all_own on public.cart_items
  for all to authenticated
  using (
    exists (select 1 from public.carts c
             where c.id = cart_id and c.customer_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.carts c
             where c.id = cart_id and c.customer_id = (select auth.uid()))
  );

-- ── Orders and everything hanging off them ──────────────────────────────────
-- Read-only through RLS: orders are created and advanced by the API under the
-- service-role key, inside a transaction that also writes items and history.

alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.order_status_history enable row level security;
alter table public.payments             enable row level security;

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select to authenticated using (customer_id = (select auth.uid()));

drop policy if exists order_items_select_own on public.order_items;
create policy order_items_select_own on public.order_items
  for select to authenticated
  using (
    exists (select 1 from public.orders o
             where o.id = order_id and o.customer_id = (select auth.uid()))
  );

drop policy if exists order_status_history_select_own on public.order_status_history;
create policy order_status_history_select_own on public.order_status_history
  for select to authenticated
  using (
    exists (select 1 from public.orders o
             where o.id = order_id and o.customer_id = (select auth.uid()))
  );

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments
  for select to authenticated
  using (
    exists (select 1 from public.orders o
             where o.id = order_id and o.customer_id = (select auth.uid()))
  );

-- ── Saved stores ────────────────────────────────────────────────────────────

alter table public.saved_stores enable row level security;

drop policy if exists saved_stores_all_own on public.saved_stores;
create policy saved_stores_all_own on public.saved_stores
  for all to authenticated
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));

-- ── Notifications ───────────────────────────────────────────────────────────
-- The customer may read them and mark them read; only the API creates them.

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (customer_id = (select auth.uid()));

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));

-- ── Khata: read-only for the customer (checklist 1.15) ──────────────────────
-- Select policies only. With RLS on and no insert/update/delete policy, those
-- statements are rejected for anon and authenticated no matter what they send.

alter table public.khata_accounts     enable row level security;
alter table public.khata_transactions enable row level security;

drop policy if exists khata_accounts_select_own on public.khata_accounts;
create policy khata_accounts_select_own on public.khata_accounts
  for select to authenticated using (customer_id = (select auth.uid()));

drop policy if exists khata_transactions_select_own on public.khata_transactions;
create policy khata_transactions_select_own on public.khata_transactions
  for select to authenticated
  using (
    exists (select 1 from public.khata_accounts a
             where a.id = account_id and a.customer_id = (select auth.uid()))
  );
