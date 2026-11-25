-- 0049 — when the shop cannot pack everything.
--
-- While an order is being put together (placed, accepted, preparing) the shop
-- can say a line is not available, or that only some of it is: 3 ordered, 2
-- packed. The order carries on with what there is — the customer is told and
-- may cancel the rest — instead of the whole order being cancelled.
--
--   * The missing quantity's stock hold is released.
--   * The line keeps what was ordered (ordered_quantity) so the bill and the
--     customer can see what changed; a line with nothing left is kept but
--     inactive, like a substituted one.
--   * The bill is recomputed the way a substitution recomputes it (0043).
--   * A prepaid order that now costs less gets the difference back at once,
--     as an adjustment refund (khata: credited straight to the account).
--
-- Idempotent.

alter table public.order_items add column if not exists ordered_quantity integer;
alter table public.order_items add column if not exists unavailable_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_ordered_quantity') then
    alter table public.order_items add constraint order_items_ordered_quantity
      check (ordered_quantity is null or ordered_quantity >= quantity);
  end if;
end $$;

-- When the shop last changed what is in the order. Also what lets the
-- customer cancel a changed order a little later than usual.
alter table public.orders add column if not exists items_changed_at timestamptz;

create or replace function public.mark_item_unavailable(p_store_id uuid, p_order_id uuid, p_item_id uuid, p_quantity_left integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order     public.orders%rowtype;
  v_item      public.order_items%rowtype;
  v_missing   integer;
  v_held      integer;
  v_release   integer;
  v_on_hand   integer;
  v_reserved  integer;
  v_line_sub  integer;
  v_line_tax  integer;
  v_subtotal  integer;
  v_tax       integer;
  v_discount  integer;
  v_new_total integer;
  v_left      integer;
  v_payment   public.payments%rowtype;
  v_refunded  integer;
  v_diff      integer;
  v_refund    uuid;
  v_account   uuid;
  v_txn       uuid;
begin
  select * into v_order from public.orders where id = p_order_id and store_id = p_store_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.status not in ('placed', 'accepted', 'preparing') then
    raise exception 'ORDER_LOCKED' using errcode = 'P0001';
  end if;

  select * into v_item from public.order_items where id = p_item_id and order_id = v_order.id for update;
  if not found or not v_item.is_active then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_quantity_left is null or p_quantity_left < 0 or p_quantity_left >= v_item.quantity then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;

  -- The last unit of the last line: there is no order left to carry on.
  select coalesce(sum(quantity), 0) into v_left from public.order_items
   where order_id = v_order.id and is_active and id <> v_item.id;
  if v_left = 0 and p_quantity_left = 0 then
    raise exception 'NOTHING_LEFT' using errcode = 'P0001';
  end if;

  v_missing := v_item.quantity - p_quantity_left;

  -- Release what this order holds of the missing quantity.
  if v_item.variant_id is not null then
    select coalesce(sum(reserved_change), 0) into v_held from public.inventory_ledger
     where reference_type = 'order' and reference_id = v_order.id and variant_id = v_item.variant_id;
    v_release := least(greatest(v_held, 0), v_missing);
    if v_release > 0 then
      update public.product_variants set reserved_quantity = reserved_quantity - v_release
       where id = v_item.variant_id returning quantity_on_hand, reserved_quantity into v_on_hand, v_reserved;
      insert into public.inventory_ledger (store_id, product_id, variant_id, movement_type, on_hand_change, reserved_change,
        on_hand_after, reserved_after, reference_type, reference_id, performed_by_type, notes)
      values (v_order.store_id, v_item.product_id, v_item.variant_id, 'order_released', 0, -v_release, v_on_hand, v_reserved,
        'order', v_order.id, 'system', 'Not available to pack');
    end if;
  end if;

  if p_quantity_left = 0 then
    update public.order_items
       set is_active = false, unavailable_at = now(), ordered_quantity = coalesce(ordered_quantity, quantity)
     where id = v_item.id;
  else
    v_line_sub := v_item.unit_price_paise * p_quantity_left;
    v_line_tax := floor((v_line_sub * round(v_item.tax_percent * 100) + 5000) / 10000);
    update public.order_items
       set ordered_quantity = coalesce(ordered_quantity, quantity), quantity = p_quantity_left,
           tax_paise = v_line_tax, line_total_paise = v_line_sub + v_line_tax, unavailable_at = now(),
           discount_paise = case when coalesce(discount_paise, 0) = 0 then discount_paise
                                 else floor(discount_paise::numeric * p_quantity_left / v_item.quantity) end
     where id = v_item.id;
  end if;

  select coalesce(sum(unit_price_paise * quantity), 0), coalesce(sum(tax_paise), 0) into v_subtotal, v_tax
    from public.order_items where order_id = v_order.id and is_active;
  v_discount := least(v_order.discount_paise, v_subtotal);
  v_new_total := v_subtotal - v_discount + v_order.delivery_fee_paise + v_tax;

  update public.orders
     set subtotal_paise = v_subtotal, discount_paise = v_discount, tax_paise = v_tax, total_paise = v_new_total,
         items_changed_at = now()
   where id = v_order.id;

  -- A prepaid order that now costs less: the difference goes back now.
  select * into v_payment from public.payments where order_id = v_order.id and status = 'paid'
   order by created_at desc limit 1;
  if found then
    select coalesce(sum(amount_paise), 0) into v_refunded from public.refunds
     where payment_id = v_payment.id and status <> 'failed';
    v_diff := v_payment.amount_paise - v_refunded - v_new_total;
    if v_diff > 0 then
      insert into public.refunds (order_id, payment_id, store_id, customer_id, amount_paise, currency, method, provider,
        reason, initiated_by, kind)
      values (v_order.id, v_payment.id, v_order.store_id, v_order.customer_id, v_diff, v_payment.currency,
        case v_payment.provider when 'khata' then 'khata_credit' when 'cash' then 'cash' else 'provider' end,
        case when v_payment.provider in ('khata', 'cash') then null else v_payment.provider end,
        'Item not available', 'store', 'adjustment')
      returning id into v_refund;
      insert into public.refund_events (refund_id, from_status, to_status, source, note)
      values (v_refund, null, 'initiated', 'system', 'An item was not available');
      if v_payment.provider = 'khata' then
        select id into v_account from public.khata_accounts where customer_id = v_order.customer_id and store_id = v_order.store_id for update;
        insert into public.khata_transactions (account_id, type, amount_paise, description, order_id, entry_kind, recorded_by_type, refund_id)
        values (v_account, 'credit', v_diff, 'Item not available, order ' || v_order.order_number, v_order.id, 'refund_credit', 'system', v_refund)
        returning id into v_txn;
        update public.refunds set khata_transaction_id = v_txn where id = v_refund;
        perform public.record_refund_update(jsonb_build_object('refund_id', v_refund, 'to_status', 'refunded', 'source', 'system', 'note', 'Credited to khata'));
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id, 'item_id', v_item.id, 'missing', v_missing, 'quantity_left', p_quantity_left,
    'total_paise', v_new_total, 'previous_total_paise', v_order.total_paise, 'refund_id', v_refund
  );
end;
$$;

revoke all on function public.mark_item_unavailable(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.mark_item_unavailable(uuid, uuid, uuid, integer) to service_role;
