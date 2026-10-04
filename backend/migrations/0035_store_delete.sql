-- 0035_store_delete.sql — a merchant can delete a store, permanently.
-- MERCHANT_RULES S-19.
--
-- Unlike a product (0034, archived), a deleted store is gone: its catalogue,
-- stock history, orders, counter sales, khata and photos all go with it.
-- Most of that already cascades from stores; three tables were made
-- `on delete restrict` so that nothing could remove them by accident —
-- orders, sales and inventory_ledger — and the ledger refuses deletes
-- outright. delete_store removes those deliberately, in one transaction.
--
-- A store with an order still in progress is refused: a customer is waiting
-- on it, and stock is reserved for it.

-- The ledger stays append-only, except while delete_store is running — it
-- sets cpse.deleting_store for its own transaction only.
create or replace function public.reject_inventory_ledger_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_setting('cpse.deleting_store', true) = 'on' then
    return old;
  end if;
  raise exception 'inventory_ledger rows are immutable; record a new movement instead';
end;
$$;

create or replace function public.delete_store(p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Lock the store first: no order or sale can start on it while it goes.
  perform 1 from stores where id = p_store_id for update;
  if not found then
    raise exception 'STORE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from orders
     where store_id = p_store_id
       and status not in ('completed', 'cancelled', 'rejected')
  ) then
    raise exception 'ORDERS_IN_PROGRESS' using errcode = 'P0001';
  end if;

  perform set_config('cpse.deleting_store', 'on', true);

  -- Khata first: removing an order would otherwise null khata_transactions.order_id,
  -- an update that the khata ledger refuses.
  delete from khata_accounts where store_id = p_store_id;
  delete from inventory_ledger where store_id = p_store_id;
  delete from sales where store_id = p_store_id;
  delete from orders where store_id = p_store_id;
  delete from stores where id = p_store_id;

  perform set_config('cpse.deleting_store', 'off', true);
end;
$$;

revoke all on function public.delete_store(uuid) from public, anon, authenticated;
grant execute on function public.delete_store(uuid) to service_role;
