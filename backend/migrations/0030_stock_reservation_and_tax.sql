-- 0030_stock_reservation_and_tax.sql — stock moves to the variant, orders
-- reserve it, and order lines carry tax.
--
-- D-4 (tax added on top), D-5 (reserve at placement, with a ledger) and D-6
-- (every product has at least one variant). MERCHANT_RULES §5 – §7.
--
--   placed            reserved += qty                      ledger: order_reserved
--   rejected/cancelled reserved -= what this order holds   ledger: order_released
--   completed         on hand and reserved -= that amount  ledger: order_fulfilled
--
-- Release and fulfilment are a trigger on orders.status, not something each
-- caller remembers to do. Every way an order can end — the customer cancelling,
-- the merchant rejecting, the expiry sweep, a completion — changes that column,
-- so none of them can forget to give the stock back (the CPSE gap D-5 fixes).

-- ── 1. One-time move off the legacy `stock` columns ─────────────────────────
-- Guarded by the legacy column still existing, and the last step drops it, so
-- this block runs exactly once however many times the file is applied.
-- (PL/pgSQL plans each statement when it first runs, so the references to
-- `stock` below are never parsed on a database where it is already gone.)
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'products' and column_name = 'stock'
  ) then
    -- `stock is null` meant "not counted". A product with variants is counted
    -- when any of its variants was; one without, when the product itself was.
    update public.products p
       set track_inventory = case
             when exists (select 1 from public.product_variants v where v.product_id = p.id)
               then exists (select 1 from public.product_variants v
                             where v.product_id = p.id and v.stock is not null)
             else p.stock is not null
           end;

    update public.product_variants set quantity_on_hand = coalesce(stock, 0);

    -- D-6. A product sold without options gets one variant carrying its price,
    -- MRP and stock. The customer API hides a lone variant, so nothing changes
    -- on screen.
    insert into public.product_variants
      (product_id, name, price_paise, mrp_paise, is_available, sort_order, quantity_on_hand)
    select p.id, 'Default', p.price_paise, p.mrp_paise, true, 0, coalesce(p.stock, 0)
      from public.products p
     where not exists (select 1 from public.product_variants v where v.product_id = p.id);

    -- Cart lines saved without a variant point at the product's first one,
    -- unless the cart already has a line for that variant — then the bare line
    -- is dropped rather than merged, and the cart's reprice shows what is left.
    with first_variant as (
      select distinct on (product_id) product_id, id
        from public.product_variants
       order by product_id, sort_order, name
    )
    update public.cart_items ci
       set variant_id = f.id
      from first_variant f
     where f.product_id = ci.product_id
       and ci.variant_id is null
       and not exists (
         select 1 from public.cart_items d
          where d.cart_id = ci.cart_id
            and d.product_id = ci.product_id
            and d.variant_id = f.id
       );
    delete from public.cart_items where variant_id is null;

    alter table public.products drop column stock;
    alter table public.product_variants drop column stock;
  end if;
end $$;

-- Every cart line names the variant it buys (D-6).
alter table public.cart_items alter column variant_id set not null;

-- ── 2. A product's price is its cheapest variant's ──────────────────────────
-- products.price_paise / mrp_paise stay, because every listing reads them, but
-- they are now derived: kept equal to the cheapest available variant (or the
-- cheapest at all, when none is available). Merchant-One let a product price
-- edit miss the variant that orders actually charge (MERCHANT_RULES P-10);
-- with this the variant is the only price anyone sets.
create or replace function public.sync_product_price()
returns trigger
language plpgsql
as $$
declare
  v_product_id uuid;
begin
  for v_product_id in
    select distinct id from unnest(array[
      case when tg_op <> 'INSERT' then old.product_id end,
      case when tg_op <> 'DELETE' then new.product_id end
    ]) as ids (id)
     where id is not null
  loop
    update public.products p
       set price_paise = cheapest.price_paise,
           mrp_paise   = cheapest.mrp_paise
      from (
        select v.price_paise, v.mrp_paise
          from public.product_variants v
         where v.product_id = v_product_id
         order by v.is_available desc, v.price_paise asc, v.sort_order asc
         limit 1
      ) cheapest
     where p.id = v_product_id
       and (p.price_paise, p.mrp_paise) is distinct from (cheapest.price_paise, cheapest.mrp_paise);
  end loop;
  return null;
end;
$$;

drop trigger if exists product_variants_sync_product_price on public.product_variants;
create trigger product_variants_sync_product_price
  after insert or delete or update of price_paise, mrp_paise, is_available, product_id
  on public.product_variants
  for each row execute function public.sync_product_price();

-- Bring every product in line once; afterwards the trigger keeps it there.
with cheapest as (
  select distinct on (product_id) product_id, price_paise, mrp_paise
    from public.product_variants
   order by product_id, is_available desc, price_paise asc, sort_order asc
)
update public.products p
   set price_paise = c.price_paise,
       mrp_paise   = c.mrp_paise
  from cheapest c
 where c.product_id = p.id
   and (p.price_paise, p.mrp_paise) is distinct from (c.price_paise, c.mrp_paise);

-- ── 3. An order line's total includes its tax (MERCHANT_RULES O-16) ─────────
alter table public.order_items drop constraint if exists order_items_line_total_matches;
alter table public.order_items
  add constraint order_items_line_total_matches
  check (line_total_paise = unit_price_paise * quantity + tax_paise);

-- ── 4. create_order reserves instead of decrementing ────────────────────────
-- Same contract as 0020 — idempotent replay, one transaction, ITEM_UNAVAILABLE
-- naming the product — with three changes: every line names a variant, a
-- counted variant is reserved (not decremented) and the reservation is logged,
-- and each line carries its SKU and tax.
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
  v_order_id        uuid;
  v_order_number    text;
  v_item            jsonb;
  v_product_id      uuid;
  v_variant_id      uuid;
  v_quantity        integer;
  v_tracked         boolean;
  v_on_hand         integer;
  v_reserved        integer;
begin
  -- A replayed Idempotency-Key returns the original order (checklist 7.5).
  if v_idempotency_key is not null then
    select id, order_number into v_order_id, v_order_number
      from public.orders
     where customer_id = v_customer_id
       and idempotency_key = v_idempotency_key;

    if found then
      return jsonb_build_object(
        'order_id', v_order_id,
        'order_number', v_order_number,
        'replayed', true
      );
    end if;
  end if;

  insert into public.orders (
    store_id, customer_id, fulfilment_mode, status, payment_status,
    address_id, delivery_address, store_snapshot,
    subtotal_paise, discount_paise, delivery_fee_paise, tax_paise, total_paise,
    customer_note, idempotency_key
  ) values (
    v_store_id,
    v_customer_id,
    (payload ->> 'fulfilment_mode')::fulfilment_mode,
    v_status,
    (payload ->> 'payment_status')::payment_status,
    nullif(payload ->> 'address_id', '')::uuid,
    payload -> 'delivery_address',
    payload -> 'store_snapshot',
    (payload ->> 'subtotal_paise')::integer,
    (payload ->> 'discount_paise')::integer,
    (payload ->> 'delivery_fee_paise')::integer,
    (payload ->> 'tax_paise')::integer,
    (payload ->> 'total_paise')::integer,
    nullif(payload ->> 'customer_note', ''),
    v_idempotency_key
  )
  returning id, order_number into v_order_id, v_order_number;

  -- Lines are taken in variant order so two orders sharing variants lock them
  -- in the same sequence and cannot deadlock each other.
  for v_item in
    select value from jsonb_array_elements(payload -> 'items') order by value ->> 'variant_id'
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_variant_id := nullif(v_item ->> 'variant_id', '')::uuid;
    v_quantity   := (v_item ->> 'quantity')::integer;

    -- Availability and stock re-checked under the variant's row lock: the cart
    -- was validated moments ago and the merchant may have changed something.
    -- `available = on hand - reserved` is what stops two customers both buying
    -- the last unit (D-5).
    select p.track_inventory, v.quantity_on_hand, v.reserved_quantity
      into v_tracked, v_on_hand, v_reserved
      from public.product_variants v
      join public.products p on p.id = v.product_id
     where v.id = v_variant_id
       and p.id = v_product_id
       and p.store_id = v_store_id
       and p.is_available
       and v.is_available
       for update of v;

    if not found or (v_tracked and v_on_hand - v_reserved < v_quantity) then
      raise exception 'ITEM_UNAVAILABLE:%', coalesce(v_item ->> 'product_name', 'An item')
        using errcode = 'P0001';
    end if;

    insert into public.order_items (
      order_id, product_id, variant_id, product_name, variant_name, sku,
      image_url, unit_price_paise, quantity, tax_percent, tax_paise, line_total_paise
    ) values (
      v_order_id,
      v_product_id,
      v_variant_id,
      v_item ->> 'product_name',
      nullif(v_item ->> 'variant_name', ''),
      nullif(v_item ->> 'sku', ''),
      nullif(v_item ->> 'image_url', ''),
      (v_item ->> 'unit_price_paise')::integer,
      v_quantity,
      coalesce((v_item ->> 'tax_percent')::numeric, 0),
      coalesce((v_item ->> 'tax_paise')::integer, 0),
      (v_item ->> 'line_total_paise')::integer
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

  if v_cart_id is not null then
    update public.carts set checked_out_at = now() where id = v_cart_id and customer_id = v_customer_id;
    delete from public.cart_items where cart_id = v_cart_id;
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'replayed', false
  );
end;
$$;

revoke all on function public.create_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_order(jsonb) to service_role;

-- ── 5. Ending an order releases or fulfils what it reserved ─────────────────
-- What an order holds is read back from the ledger, never from its lines, so a
-- release returns exactly what was reserved — never more (MERCHANT_RULES I-7),
-- and nothing at all for an order placed before reservations existed. Once
-- released the net is zero, so a second end state could not release twice even
-- if the state machine allowed one.
--
-- Recorded as 'system': the status change itself, and who made it, is in
-- order_status_history.
create or replace function public.apply_order_stock_movement()
returns trigger
language plpgsql
as $$
declare
  v_movement inventory_movement;
  v_held     record;
  v_on_hand  integer;
  v_reserved integer;
begin
  if new.status in ('cancelled', 'rejected') then
    v_movement := 'order_released';
  elsif new.status = 'completed' then
    v_movement := 'order_fulfilled';
  else
    return null;
  end if;

  for v_held in
    select l.variant_id, l.product_id, sum(l.reserved_change)::integer as quantity
      from public.inventory_ledger l
     where l.reference_type = 'order'
       and l.reference_id = new.id
     group by l.variant_id, l.product_id
    having sum(l.reserved_change) > 0
     order by l.variant_id
  loop
    update public.product_variants
       set reserved_quantity = reserved_quantity - v_held.quantity,
           quantity_on_hand  = quantity_on_hand
                               - case when v_movement = 'order_fulfilled' then v_held.quantity else 0 end
     where id = v_held.variant_id
     returning quantity_on_hand, reserved_quantity into v_on_hand, v_reserved;

    insert into public.inventory_ledger (
      store_id, product_id, variant_id, movement_type,
      on_hand_change, reserved_change, on_hand_after, reserved_after,
      reference_type, reference_id, performed_by_type, performed_by_id
    ) values (
      new.store_id, v_held.product_id, v_held.variant_id, v_movement,
      case when v_movement = 'order_fulfilled' then -v_held.quantity else 0 end,
      -v_held.quantity, v_on_hand, v_reserved,
      'order', new.id, 'system', null
    );
  end loop;

  return null;
end;
$$;

drop trigger if exists orders_apply_stock_movement on public.orders;
create trigger orders_apply_stock_movement
  after update of status on public.orders
  for each row
  when (old.status is distinct from new.status)
  execute function public.apply_order_stock_movement();

-- ── 6. The expiry sweep no longer restocks by hand ──────────────────────────
-- Same as 0022 minus the two stock updates: cancelling the order is enough,
-- because the trigger above releases what it reserved.
create or replace function public.expire_stale_pending_orders(
  p_older_than interval default interval '2 hours'
)
returns table (order_id uuid, order_number text, total_paise integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - p_older_than;
  target record;
begin
  for target in
    select o.id, o.order_number, o.total_paise
      from public.orders o
     where o.status = 'pending_payment'
       and o.placed_at < cutoff
     for update skip locked
  loop
    update public.orders
       set status = 'cancelled',
           payment_status = case when payment_status = 'pending' then 'cancelled'
                                 else payment_status end,
           cancelled_at = now(),
           cancellation_reason = 'Payment was not completed in time'
     where id = target.id;

    insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (target.id, 'pending_payment', 'cancelled', 'system',
            'Expired: payment not completed');

    order_id := target.id;
    order_number := target.order_number;
    total_paise := target.total_paise;
    return next;
  end loop;
end;
$$;

revoke all on function public.expire_stale_pending_orders(interval)
  from public, anon, authenticated;
grant execute on function public.expire_stale_pending_orders(interval) to service_role;
