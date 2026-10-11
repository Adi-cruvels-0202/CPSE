-- 0038_refunds.sql — paid cancellations are settled, traceably.
--
-- Roadmap §4 P2 "Cancellation & Refund Settlement", "Khata Refund/Adjustment
-- Link"; §5 P5 "Refund/cancellation handling", "Refund Tracking Status"; §6
-- "Cancellation & Refund"; §7 Refund rule.
--
-- Before this, cancelling a paid order changed orders.status and nothing else:
-- the payment stayed 'paid', no money was owed back on record, and the customer
-- had no way to see what happened to it. Now:
--
--   * every way a paid order ends cancelled or rejected opens a refund, in the
--     same transaction as the status change (a trigger, like the stock release
--     in 0030 — no caller can forget it);
--   * the refund is linked to the order AND the payment it returns, and there
--     is at most one live refund per payment, so a retry or a replayed event can
--     never refund twice;
--   * its state moves only through record_refund_update, which allows only the
--     legal transitions, ignores stale and replayed provider events, and writes
--     an append-only refund_events row for each change;
--   * the payment and the order say 'refunded' only once the refund is
--     confirmed — by the provider, or by our own ledger for a khata credit;
--   * a khata-paid order is refunded as a separate, linked credit entry in the
--     khata, never by editing the original charge.

do $$ begin
  create type refund_status as enum ('initiated', 'processing', 'refunded', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists public.refunds (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete restrict,
  payment_id          uuid not null references public.payments (id) on delete restrict,
  store_id            uuid not null references public.stores (id) on delete restrict,
  customer_id         uuid not null references public.customers (id) on delete restrict,
  amount_paise        integer not null,
  currency            text not null default 'INR',
  -- provider     — back to the card/UPI/bank through the gateway
  -- khata_credit — a credit entry in the customer's khata at this store
  -- cash         — handed back over the counter; confirmed by the merchant
  method              text not null,
  provider            text,
  provider_refund_ref text,
  status              refund_status not null default 'initiated',
  reason              text,
  initiated_by        text not null,
  attempts            integer not null default 0,
  last_attempt_at     timestamptz,
  failure_reason      text,
  khata_transaction_id uuid references public.khata_transactions (id) on delete restrict,
  initiated_at        timestamptz not null default now(),
  processing_at       timestamptz,
  refunded_at         timestamptz,
  failed_at           timestamptz,
  raw_payload         jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint refunds_amount_positive check (amount_paise > 0),
  constraint refunds_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint refunds_method check (method in ('provider', 'khata_credit', 'cash')),
  constraint refunds_provider_for_provider check ((method = 'provider') = (provider is not null)),
  constraint refunds_initiated_by check (initiated_by in ('customer', 'store', 'system', 'payment_webhook')),
  constraint refunds_attempts_nonneg check (attempts >= 0),
  constraint refunds_reason_len check (reason is null or char_length(reason) <= 300),
  constraint refunds_refunded_has_time check (status <> 'refunded' or refunded_at is not null),
  constraint refunds_failed_has_reason check (status <> 'failed' or failure_reason is not null)
);

create index if not exists refunds_order_id_idx on public.refunds (order_id);
create index if not exists refunds_payment_id_idx on public.refunds (payment_id);
create index if not exists refunds_store_id_idx on public.refunds (store_id, created_at desc);
create index if not exists refunds_customer_id_idx on public.refunds (customer_id);
create index if not exists refunds_khata_transaction_id_idx on public.refunds (khata_transaction_id);
create index if not exists refunds_open_idx on public.refunds (status, updated_at) where status in ('initiated', 'processing');
-- The duplicate-refund guard: one live refund per payment.
create unique index if not exists refunds_one_live_per_payment
  on public.refunds (payment_id) where status <> 'failed';
create unique index if not exists refunds_provider_ref_key
  on public.refunds (provider, provider_refund_ref) where provider_refund_ref is not null;

drop trigger if exists refunds_set_updated_at on public.refunds;
create trigger refunds_set_updated_at
  before update on public.refunds
  for each row execute function public.set_updated_at();

-- Append-only history of every refund state change.
create table if not exists public.refund_events (
  id                uuid primary key default gen_random_uuid(),
  refund_id         uuid not null references public.refunds (id) on delete cascade,
  from_status       refund_status,
  to_status         refund_status not null,
  source            text not null,
  -- The provider's own event id, when the change came from one: a replayed
  -- webhook carries the same id and is recognised.
  provider_event_id text,
  note              text,
  created_at        timestamptz not null default now(),

  constraint refund_events_source check (source in ('system', 'api', 'provider', 'webhook', 'reconciliation', 'merchant')),
  constraint refund_events_note_len check (note is null or char_length(note) <= 300)
);

create index if not exists refund_events_refund_id_idx on public.refund_events (refund_id, created_at);
create unique index if not exists refund_events_provider_event_key
  on public.refund_events (refund_id, provider_event_id) where provider_event_id is not null;

create or replace function public.reject_refund_event_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_setting('cpse.deleting_store', true) = 'on' then
    return old;
  end if;
  raise exception 'refund_events rows are immutable';
end;
$$;

drop trigger if exists refund_events_immutable on public.refund_events;
create trigger refund_events_immutable
  before update or delete on public.refund_events
  for each row execute function public.reject_refund_event_change();

-- The khata credit that settles a khata refund points back at it.
alter table public.khata_transactions
  add column if not exists refund_id uuid references public.refunds (id) on delete restrict;
create index if not exists khata_transactions_refund_id_idx on public.khata_transactions (refund_id);

alter table public.refunds enable row level security;
alter table public.refund_events enable row level security;

drop policy if exists refunds_select_own on public.refunds;
create policy refunds_select_own on public.refunds
  for select to authenticated using (customer_id = (select auth.uid()));

drop policy if exists refunds_select_owner on public.refunds;
create policy refunds_select_owner on public.refunds
  for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));

drop policy if exists refund_events_select_party on public.refund_events;
create policy refund_events_select_party on public.refund_events
  for select to authenticated
  using (exists (
    select 1 from public.refunds r
      left join public.stores s on s.id = r.store_id
     where r.id = refund_id
       and (r.customer_id = (select auth.uid()) or s.owner_id = (select auth.uid()))
  ));

-- ── Writing a refund's state ────────────────────────────────────────────────
-- payload: { refund_id, to_status, source, provider_refund_ref, failure_reason,
--            provider_event_id, note, raw }
-- Legal moves:
--   initiated  → processing | refunded | failed
--   processing → refunded | failed
--   failed     → initiated (a retry) | refunded (the provider's later word)
--   refunded   → nothing: money that is back is back.
-- An illegal or stale move (e.g. 'processing' after 'refunded', which is how
-- out-of-order webhooks arrive) is ignored and reported, not raised: the
-- provider must get a 200 or it retries forever.
-- Returns { applied, reason?, refund_id, status }.
create or replace function public.record_refund_update(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund   public.refunds%rowtype;
  v_to       refund_status := (payload ->> 'to_status')::refund_status;
  v_event_id text := nullif(payload ->> 'provider_event_id', '');
  v_ref      text := nullif(payload ->> 'provider_refund_ref', '');
  v_legal    boolean;
begin
  select * into v_refund from public.refunds where id = (payload ->> 'refund_id')::uuid for update;
  if not found then
    raise exception 'REFUND_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_event_id is not null and exists (
    select 1 from public.refund_events where refund_id = v_refund.id and provider_event_id = v_event_id
  ) then
    return jsonb_build_object('applied', false, 'reason', 'DUPLICATE_EVENT', 'refund_id', v_refund.id, 'status', v_refund.status);
  end if;

  -- A reference learned without a state change is still worth keeping.
  if v_ref is not null and v_refund.provider_refund_ref is null then
    update public.refunds set provider_refund_ref = v_ref where id = v_refund.id;
  end if;

  if v_to = v_refund.status then
    return jsonb_build_object('applied', false, 'reason', 'NO_CHANGE', 'refund_id', v_refund.id, 'status', v_refund.status);
  end if;

  v_legal := case v_refund.status
    when 'initiated'  then v_to in ('processing', 'refunded', 'failed')
    when 'processing' then v_to in ('refunded', 'failed')
    when 'failed'     then v_to in ('initiated', 'refunded')
    else false
  end;

  if not v_legal then
    return jsonb_build_object('applied', false, 'reason', 'STALE_EVENT', 'refund_id', v_refund.id, 'status', v_refund.status);
  end if;

  -- A retry may not jump the queue of a refund that is live on the same payment.
  if v_to = 'initiated' and exists (
    select 1 from public.refunds where payment_id = v_refund.payment_id and id <> v_refund.id and status <> 'failed'
  ) then
    raise exception 'REFUND_ALREADY_LIVE' using errcode = 'P0001';
  end if;

  update public.refunds
     set status = v_to,
         processing_at = case when v_to = 'processing' then coalesce(processing_at, now()) else processing_at end,
         refunded_at   = case when v_to = 'refunded' then now() else refunded_at end,
         failed_at     = case when v_to = 'failed' then now() when v_to = 'initiated' then null else failed_at end,
         failure_reason = case
                            when v_to = 'failed' then coalesce(nullif(payload ->> 'failure_reason', ''), 'The refund was not completed.')
                            when v_to in ('initiated', 'refunded') then null
                            else failure_reason
                          end,
         raw_payload = case when payload ? 'raw' then raw_payload || (payload -> 'raw') else raw_payload end
   where id = v_refund.id;

  insert into public.refund_events (refund_id, from_status, to_status, source, provider_event_id, note)
  values (v_refund.id, v_refund.status, v_to, coalesce(payload ->> 'source', 'system'), v_event_id,
          nullif(payload ->> 'note', ''));

  -- Only a confirmed refund changes what the payment and the order say.
  if v_to = 'refunded' then
    update public.payments set status = 'refunded' where id = v_refund.payment_id;
    update public.orders set payment_status = 'refunded' where id = v_refund.order_id;
  end if;

  return jsonb_build_object('applied', true, 'refund_id', v_refund.id, 'status', v_to, 'from_status', v_refund.status);
end;
$$;

revoke all on function public.record_refund_update(jsonb) from public, anon, authenticated;
grant execute on function public.record_refund_update(jsonb) to service_role;

-- ── Opening a refund for an order ───────────────────────────────────────────
-- Idempotent: if the order's paid payment already has a live refund, that one
-- is returned. Nothing paid → null (a cash order that was never collected, an
-- online order whose payment never completed).
create or replace function public.initiate_order_refund(
  p_order_id     uuid,
  p_initiated_by text default 'system',
  p_reason       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    record;
  v_payment  public.payments%rowtype;
  v_refund   public.refunds%rowtype;
  v_method   text;
  v_account  uuid;
  v_txn      uuid;
begin
  select id, order_number, store_id, customer_id into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_payment from public.payments
   where order_id = p_order_id and status = 'paid'
   order by created_at desc
   limit 1
   for update;
  if not found then
    return null;
  end if;

  select * into v_refund from public.refunds where payment_id = v_payment.id and status <> 'failed';
  if found then
    return to_jsonb(v_refund);
  end if;

  v_method := case v_payment.provider when 'khata' then 'khata_credit' when 'cash' then 'cash' else 'provider' end;

  insert into public.refunds (
    order_id, payment_id, store_id, customer_id, amount_paise, currency,
    method, provider, reason, initiated_by
  ) values (
    v_order.id, v_payment.id, v_order.store_id, v_order.customer_id, v_payment.amount_paise, v_payment.currency,
    v_method, case when v_method = 'provider' then v_payment.provider end,
    left(p_reason, 300), coalesce(p_initiated_by, 'system')
  )
  returning * into v_refund;

  insert into public.refund_events (refund_id, from_status, to_status, source, note)
  values (v_refund.id, null, 'initiated', 'system', 'Refund opened for order ' || v_order.order_number);

  -- A khata refund settles at once: our own ledger is the confirmation. The
  -- credit is a new, linked entry — the original charge is never touched.
  if v_method = 'khata_credit' then
    select id into v_account from public.khata_accounts
     where customer_id = v_order.customer_id and store_id = v_order.store_id
       for update;

    insert into public.khata_transactions (
      account_id, type, amount_paise, description, order_id, entry_kind,
      recorded_by_type, refund_id
    ) values (
      v_account, 'credit', v_refund.amount_paise,
      'Refund for cancelled order ' || v_order.order_number, v_order.id, 'refund_credit',
      'system', v_refund.id
    )
    returning id into v_txn;

    update public.refunds set khata_transaction_id = v_txn where id = v_refund.id;
    perform public.record_refund_update(jsonb_build_object(
      'refund_id', v_refund.id, 'to_status', 'refunded', 'source', 'system',
      'note', 'Credited to khata'
    ));
    select * into v_refund from public.refunds where id = v_refund.id;
  end if;

  return to_jsonb(v_refund);
end;
$$;

revoke all on function public.initiate_order_refund(uuid, text, text) from public, anon, authenticated;
grant execute on function public.initiate_order_refund(uuid, text, text) to service_role;

-- Ending a paid order opens its refund, whoever ended it.
create or replace function public.open_refund_on_order_end()
returns trigger
language plpgsql
as $$
begin
  perform public.initiate_order_refund(new.id, coalesce(new.cancelled_by, 'system'), new.cancellation_reason);
  return null;
end;
$$;

drop trigger if exists orders_open_refund on public.orders;
create trigger orders_open_refund
  after update of status on public.orders
  for each row
  when (old.status is distinct from new.status and new.status in ('cancelled', 'rejected'))
  execute function public.open_refund_on_order_end();

-- ── delete_store learns about refunds ───────────────────────────────────────
-- Money in flight blocks deletion, like an order in progress. Otherwise the
-- refunds go with the store (their events cascade).
create or replace function public.delete_store(p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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

  if exists (
    select 1 from refunds where store_id = p_store_id and status in ('initiated', 'processing')
  ) then
    raise exception 'REFUNDS_IN_PROGRESS' using errcode = 'P0001';
  end if;

  perform set_config('cpse.deleting_store', 'on', true);

  -- Refunds before the khata (a khata credit points at its refund and the
  -- refund back at the credit) and before orders and payments.
  update refunds set khata_transaction_id = null where store_id = p_store_id;
  delete from khata_transactions t using khata_accounts a
   where a.id = t.account_id and a.store_id = p_store_id and t.refund_id is not null;
  delete from refunds where store_id = p_store_id;
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
