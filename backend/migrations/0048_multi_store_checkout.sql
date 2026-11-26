-- 0048_multi_store_checkout.sql
-- One customer checkout may contain several shops. The checkout is shared,
-- while every child order and its inventory remain scoped to its own shop.

create table if not exists public.checkout_groups (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.customers (id) on delete restrict,
  idempotency_key  text not null,
  payment_method   text not null,
  total_paise      integer not null,
  created_at       timestamptz not null default now(),
  constraint checkout_groups_method check (payment_method in ('cash', 'online')),
  constraint checkout_groups_total_positive check (total_paise > 0),
  constraint checkout_groups_key_length check (char_length(idempotency_key) between 1 and 200)
);

create unique index if not exists checkout_groups_customer_idempotency_key
  on public.checkout_groups (customer_id, idempotency_key);
create index if not exists checkout_groups_customer_created_idx
  on public.checkout_groups (customer_id, created_at desc);

alter table public.orders
  add column if not exists checkout_group_id uuid references public.checkout_groups (id) on delete set null;
create index if not exists orders_checkout_group_idx on public.orders (checkout_group_id);

-- A payment can represent either one normal order, or one combined checkout.
-- For a combined checkout, one parent charge has checkout_group_id and each
-- shop order receives an allocation row linked through parent_payment_id.
alter table public.payments alter column order_id drop not null;
alter table public.payments
  add column if not exists checkout_group_id uuid references public.checkout_groups (id) on delete cascade;
alter table public.payments
  add column if not exists parent_payment_id uuid references public.payments (id) on delete cascade;
do $$ begin
  alter table public.payments add constraint payments_order_or_group
    check ((order_id is not null) <> (checkout_group_id is not null));
exception when duplicate_object then null; end $$;
create index if not exists payments_checkout_group_idx on public.payments (checkout_group_id);
create index if not exists payments_parent_payment_idx on public.payments (parent_payment_id);

alter table public.checkout_groups enable row level security;
drop policy if exists checkout_groups_select_own on public.checkout_groups;
create policy checkout_groups_select_own on public.checkout_groups
  for select to authenticated using (customer_id = (select auth.uid()));

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments
  for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid()))
    or exists (select 1 from public.checkout_groups g where g.id = checkout_group_id and g.customer_id = (select auth.uid()))
  );

-- Creates all shop orders and, for online payments, one shared payment plus
-- per-order allocations. Calling create_order inside this function keeps each
-- child order's item snapshots, stock reservations and cart checkout atomic
-- with the rest of the group.
create or replace function public.create_checkout_group(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid := (payload ->> 'customer_id')::uuid;
  v_idempotency_key text := payload ->> 'idempotency_key';
  v_payment_method text := payload ->> 'payment_method';
  v_group_id uuid;
  v_group_total integer := 0;
  v_first_order_id uuid;
  v_first_order_number text;
  v_child jsonb;
  v_child_payload jsonb;
  v_child_result jsonb;
  v_order record;
  v_payment_id uuid;
  v_replayed boolean := false;
  v_orders jsonb;
begin
  insert into public.checkout_groups (customer_id, idempotency_key, payment_method, total_paise)
  values (v_customer_id, v_idempotency_key, v_payment_method, 1)
  on conflict (customer_id, idempotency_key) do nothing
  returning id into v_group_id;

  if v_group_id is null then
    select id into v_group_id from public.checkout_groups
     where customer_id = v_customer_id and idempotency_key = v_idempotency_key
     for update;
    v_replayed := true;
  else
    for v_child in select value from jsonb_array_elements(payload -> 'orders')
    loop
      v_child_payload := v_child -> 'order';
      v_child_result := public.create_order(v_child_payload);
      update public.orders
         set checkout_group_id = v_group_id
       where id = (v_child_result ->> 'order_id')::uuid
       returning id, order_number, total_paise, store_id into v_order;

      if v_first_order_id is null then
        v_first_order_id := v_order.id;
        v_first_order_number := v_order.order_number;
      end if;
      v_group_total := v_group_total + v_order.total_paise;
    end loop;

    update public.checkout_groups set total_paise = v_group_total where id = v_group_id;

    if v_payment_method = 'online' then
      insert into public.payments (checkout_group_id, provider, amount_paise, currency, status)
      values (
        v_group_id,
        coalesce(payload ->> 'provider', 'mock'),
        v_group_total,
        'INR',
        'pending'
      ) returning id into v_payment_id;

      for v_order in
        select id, total_paise from public.orders where checkout_group_id = v_group_id order by created_at, id
      loop
        insert into public.payments (order_id, parent_payment_id, provider, amount_paise, currency, status)
        values (v_order.id, v_payment_id, coalesce(payload ->> 'provider', 'mock'), v_order.total_paise, 'INR', 'pending');
      end loop;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', o.id,
    'order_number', o.order_number,
    'store_id', o.store_id,
    'total_paise', o.total_paise,
    'status', o.status
  ) order by o.created_at, o.id), '[]'::jsonb)
    into v_orders
    from public.orders o where o.checkout_group_id = v_group_id;

  select id, order_number into v_first_order_id, v_first_order_number
    from public.orders where checkout_group_id = v_group_id order by created_at, id limit 1;

  return jsonb_build_object(
    'checkout_group_id', v_group_id,
    'total_paise', (select total_paise from public.checkout_groups where id = v_group_id),
    'first_order_id', v_first_order_id,
    'first_order_number', v_first_order_number,
    'orders', v_orders,
    'replayed', v_replayed
  );
end;
$$;

revoke all on function public.create_checkout_group(jsonb) from public, anon, authenticated;
grant execute on function public.create_checkout_group(jsonb) to service_role;

-- Keep the group charge marked refunded only after every shop allocation has
-- been refunded. A single shop cancellation is a partial refund of the charge.
create or replace function public.sync_checkout_group_payment_refund()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_payment_id is not null and new.status = 'refunded' then
    update public.payments parent
       set status = 'refunded', updated_at = now()
     where parent.id = new.parent_payment_id
       and not exists (
         select 1 from public.payments allocation
          where allocation.parent_payment_id = parent.id
            and allocation.status <> 'refunded'
       );
  end if;
  return new;
end;
$$;

drop trigger if exists payments_sync_checkout_group_refund on public.payments;
create trigger payments_sync_checkout_group_refund
after update of status on public.payments
for each row execute function public.sync_checkout_group_payment_refund();
