-- 0032_stock_movements.sql — the merchant's own stock movements: stock in,
-- stock out, and a count. MERCHANT_API.md, Inventory; MERCHANT_RULES §5.
--
-- Each one changes a variant AND writes its ledger row, under the variant's
-- row lock, so the check ("is there enough available?") and the change happen
-- against the same number a concurrent order would see. Through PostgREST that
-- needs one function, the same reason create_order is one.
--
-- The fixes over Merchant-One are enforced here, where no caller can skip them:
--   I-2  a stock out may take only what is AVAILABLE, never reserved units;
--   I-3  a count may not go below what open orders hold;
--   I-9  an uncounted product (track_inventory = false) has no stock to move.
--
-- payload: { store_id, variant_id, merchant_id, kind, quantity, new_quantity,
--            unit_cost_paise, reason, notes }
--   kind = 'stock_in'   → on hand += quantity
--          'stock_out'  → on hand -= quantity        (quantity ≤ available)
--          'adjustment' → on hand  = new_quantity    (new_quantity ≥ reserved)
-- Returns { ledger_id }.
--
-- Refusals are raised as '<CODE>' or '<CODE>:<number>' for the API to map:
--   VARIANT_NOT_FOUND, NOT_TRACKED, INSUFFICIENT_STOCK:<available>,
--   BELOW_RESERVED:<reserved>, NO_CHANGE.
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

  -- The variant must belong to this store; another store's variant is no
  -- different from one that does not exist.
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

  if v_kind = 'stock_in' then
    v_change := v_quantity;
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
    unit_cost_paise, reason, notes, performed_by_type, performed_by_id
  ) values (
    v_store_id, v_product_id, v_variant_id, v_kind,
    v_change, 0, v_on_hand, v_reserved,
    (payload ->> 'unit_cost_paise')::integer,
    nullif(payload ->> 'reason', ''),
    nullif(payload ->> 'notes', ''),
    'merchant', (payload ->> 'merchant_id')::uuid
  )
  returning id into v_ledger_id;

  return jsonb_build_object('ledger_id', v_ledger_id);
end;
$$;

revoke all on function public.record_stock_movement(jsonb) from public, anon, authenticated;
grant execute on function public.record_stock_movement(jsonb) to service_role;
