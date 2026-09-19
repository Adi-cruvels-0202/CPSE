-- 0022_order_hygiene.sql — cleanup for records the customer abandoned.
-- Checklist 10.6: no orphaned cart, checkout or order records.
--
-- Orphans are already impossible by construction: every foreign key in this
-- schema carries an explicit ON DELETE rule (cascade, set null or restrict), so
-- nothing is left pointing at a row that has gone. What the schema cannot fix on
-- its own is the opposite problem — records that are not orphaned but are dead:
--
--   * an online order stuck in 'pending_payment' because the customer closed
--     the gateway tab. It holds decremented stock that no one will ever pay for.
--   * the cart that order was built from, left checked out, which is correct,
--     and the cart of a customer who simply never came back, which is not worth
--     keeping forever.
--
-- Both are handled here as explicit, idempotent, auditable functions rather than
-- a background job: the portal calls neither one. `npm run db:maintenance` does.

-- ── Stale unpaid orders ─────────────────────────────────────────────────────
-- Cancels online orders that never got paid for, returns their stock, and
-- records the transition in order_status_history like any other status change.
-- Only ever touches 'pending_payment', so a paid or accepted order is untouchable.
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
     -- Skips a row another run of this function already has, so two overlapping
     -- invocations cannot both cancel the same order.
     for update skip locked
  loop
    -- Give the stock back, for the items that still track it.
    update public.products p
       set stock = p.stock + oi.quantity
      from public.order_items oi
     where oi.order_id = target.id
       and oi.product_id = p.id
       and p.stock is not null
       and oi.variant_id is null;

    update public.product_variants v
       set stock = v.stock + oi.quantity
      from public.order_items oi
     where oi.order_id = target.id
       and oi.variant_id = v.id
       and v.stock is not null;

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

-- ── Abandoned carts ─────────────────────────────────────────────────────────
-- Deletes carts nobody has touched in a long time. Items go with them through
-- the cart_items cascade. A checked-out cart is kept regardless of age: it is
-- the provenance of an order, and `create_order` stamps checked_out_at on it.
create or replace function public.purge_abandoned_carts(
  p_older_than interval default interval '90 days'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  with deleted as (
    delete from public.carts
     where checked_out_at is null
       and updated_at < now() - p_older_than
    returning id
  )
  select count(*) into removed from deleted;

  return removed;
end;
$$;

-- Neither function is reachable from the portal's own role: expiring an order
-- is an operator action, not something a customer or an anon token can trigger.
-- `anon` and `authenticated` are named explicitly: Supabase's default privileges
-- grant EXECUTE on a new function to both, and revoking from the PUBLIC
-- pseudo-role does not take those away. Getting this wrong on these two would be
-- severe — they cancel orders and delete carts.
revoke all on function public.expire_stale_pending_orders(interval)
  from public, anon, authenticated;
revoke all on function public.purge_abandoned_carts(interval)
  from public, anon, authenticated;
grant execute on function public.expire_stale_pending_orders(interval) to service_role;
grant execute on function public.purge_abandoned_carts(interval)      to service_role;
