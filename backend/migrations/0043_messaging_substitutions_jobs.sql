-- 0043_messaging_substitutions_jobs.sql — talking to the shop, explicit
-- substitutions, store announcements, and the machinery for scheduled work.
--
-- Roadmap §5 P3 (ask the shop, special requests, order messaging, store-
-- specific notifications), P5 (transparent substitutions, customer support /
-- escalation), P4 (reorder reminders); Phase C (notifications, recurring
-- operations); §7 "Automation should propose actions where risk is meaningful".

-- ── Conversations ───────────────────────────────────────────────────────────
create table if not exists public.conversations (
  id                    uuid primary key default gen_random_uuid(),
  store_id              uuid not null references public.stores (id) on delete cascade,
  customer_id           uuid not null references public.customers (id) on delete cascade,
  order_id              uuid references public.orders (id) on delete cascade,
  product_id            uuid references public.products (id) on delete set null,
  -- question: ask the shop about a product or the store
  -- special_request: something the shop has to arrange (a custom item, packing)
  -- order: about one order
  -- support: a problem with an order, which can be escalated to the platform
  kind                  text not null,
  request_type          text,
  subject               text not null,
  status                text not null default 'awaiting_store',
  escalated_at          timestamptz,
  escalation_reason     text,
  resolved_at           timestamptz,
  last_message_at       timestamptz not null default now(),
  customer_read_at      timestamptz,
  merchant_read_at      timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint conversations_kind check (kind in ('question', 'special_request', 'order', 'support')),
  constraint conversations_request_type check (
    request_type is null or request_type in ('custom_item', 'packaging', 'delivery_time', 'bulk_order', 'other')
  ),
  constraint conversations_subject_len check (char_length(subject) between 1 and 120),
  constraint conversations_status check (status in ('awaiting_store', 'awaiting_customer', 'resolved', 'escalated')),
  constraint conversations_order_kinds check (kind not in ('order', 'support') or order_id is not null),
  constraint conversations_escalation check ((status = 'escalated') <= (escalated_at is not null)),
  constraint conversations_escalation_reason_len check (escalation_reason is null or char_length(escalation_reason) <= 500)
);

create index if not exists conversations_store_id_idx on public.conversations (store_id, last_message_at desc);
create index if not exists conversations_customer_id_idx on public.conversations (customer_id, last_message_at desc);
create index if not exists conversations_order_id_idx on public.conversations (order_id);
create index if not exists conversations_product_id_idx on public.conversations (product_id);
create index if not exists conversations_escalated_idx on public.conversations (escalated_at) where status = 'escalated';

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_type     text not null,
  sender_id       uuid,
  body            text not null,
  created_at      timestamptz not null default now(),

  constraint messages_sender check (sender_type in ('customer', 'merchant', 'admin', 'system')),
  constraint messages_sender_id check ((sender_type = 'system') = (sender_id is null)),
  constraint messages_body_len check (char_length(body) between 1 and 2000)
);

create index if not exists messages_conversation_id_idx on public.messages (conversation_id, created_at);

-- A message is what was said; it is not edited.
create or replace function public.reject_message_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'messages are immutable';
end;
$$;

drop trigger if exists messages_immutable on public.messages;
create trigger messages_immutable before update on public.messages
  for each row execute function public.reject_message_change();

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists conversations_select_party on public.conversations;
create policy conversations_select_party on public.conversations
  for select to authenticated
  using (customer_id = (select auth.uid())
         or exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));

drop policy if exists messages_select_party on public.messages;
create policy messages_select_party on public.messages
  for select to authenticated
  using (exists (select 1 from public.conversations c
                  left join public.stores s on s.id = c.store_id
                 where c.id = conversation_id
                   and (c.customer_id = (select auth.uid()) or s.owner_id = (select auth.uid()))));

-- ── Store announcements to opted-in followers ───────────────────────────────
create table if not exists public.store_announcements (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references public.stores (id) on delete cascade,
  title           text not null,
  body            text,
  created_by      uuid references public.merchants (id) on delete set null,
  recipient_count integer not null default 0,
  created_at      timestamptz not null default now(),

  constraint store_announcements_title_len check (char_length(title) between 1 and 120),
  constraint store_announcements_body_len check (body is null or char_length(body) <= 500),
  constraint store_announcements_count_nonneg check (recipient_count >= 0)
);

create index if not exists store_announcements_store_id_idx on public.store_announcements (store_id, created_at desc);
create index if not exists store_announcements_created_by_idx on public.store_announcements (created_by);
alter table public.store_announcements enable row level security;
drop policy if exists store_announcements_select_owner on public.store_announcements;
create policy store_announcements_select_owner on public.store_announcements for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));

-- ── Substitutions ───────────────────────────────────────────────────────────
-- An item the shop cannot supply, replaced only with the customer's agreement
-- (or, if they chose "allow similar", automatically — when it costs them no
-- more). The customer never pays more because of a substitution: a dearer
-- replacement is charged at the original price; a cheaper one lowers the bill,
-- and a prepaid difference is refunded.
create table if not exists public.order_substitutions (
  id                         uuid primary key default gen_random_uuid(),
  order_id                   uuid not null references public.orders (id) on delete cascade,
  order_item_id              uuid not null references public.order_items (id) on delete cascade,
  store_id                   uuid not null references public.stores (id) on delete cascade,
  customer_id                uuid not null references public.customers (id) on delete cascade,
  proposed_product_id        uuid not null references public.products (id) on delete cascade,
  proposed_variant_id        uuid not null references public.product_variants (id) on delete cascade,
  proposed_name              text not null,
  proposed_variant_name      text,
  proposed_quantity          integer not null,
  -- What the replacement line will cost the customer (≤ the original line).
  proposed_unit_price_paise  integer not null,
  original_line_paise        integer not null,
  merchant_note              text,
  customer_note              text,
  status                     text not null default 'pending',
  auto_approved              boolean not null default false,
  new_order_item_id          uuid references public.order_items (id) on delete set null,
  created_at                 timestamptz not null default now(),
  responded_at               timestamptz,

  constraint order_substitutions_quantity check (proposed_quantity between 1 and 999),
  constraint order_substitutions_price check (proposed_unit_price_paise >= 0 and original_line_paise >= 0),
  constraint order_substitutions_status check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  constraint order_substitutions_responded check ((status = 'pending') = (responded_at is null)),
  constraint order_substitutions_notes check (
    (merchant_note is null or char_length(merchant_note) <= 300) and (customer_note is null or char_length(customer_note) <= 300)
  )
);

create index if not exists order_substitutions_order_id_idx on public.order_substitutions (order_id);
create index if not exists order_substitutions_order_item_id_idx on public.order_substitutions (order_item_id);
create index if not exists order_substitutions_store_id_idx on public.order_substitutions (store_id);
create index if not exists order_substitutions_customer_id_idx on public.order_substitutions (customer_id);
create index if not exists order_substitutions_product_idx on public.order_substitutions (proposed_product_id);
create index if not exists order_substitutions_variant_idx on public.order_substitutions (proposed_variant_id);
create index if not exists order_substitutions_new_item_idx on public.order_substitutions (new_order_item_id);
create unique index if not exists order_substitutions_one_pending_per_item
  on public.order_substitutions (order_item_id) where status = 'pending';

alter table public.order_substitutions enable row level security;
drop policy if exists order_substitutions_select_party on public.order_substitutions;
create policy order_substitutions_select_party on public.order_substitutions for select to authenticated
  using (customer_id = (select auth.uid())
         or exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));

-- A replaced line stays on the order, marked, so the bill shows what happened.
alter table public.order_items add column if not exists is_active boolean not null default true;
alter table public.order_items add column if not exists replaced_by_substitution_id uuid references public.order_substitutions (id) on delete set null;
create index if not exists order_items_replaced_by_idx on public.order_items (replaced_by_substitution_id);

-- ── Refunds can be partial adjustments too ──────────────────────────────────
alter table public.refunds add column if not exists kind text not null default 'cancellation';
alter table public.refunds add column if not exists substitution_id uuid references public.order_substitutions (id) on delete set null;
create index if not exists refunds_substitution_id_idx on public.refunds (substitution_id);

do $$ begin
  alter table public.refunds add constraint refunds_kind check (kind in ('cancellation', 'adjustment'));
exception when duplicate_object then null; end $$;

-- One live CANCELLATION refund per payment; each substitution refunds once.
drop index if exists public.refunds_one_live_per_payment;
create unique index if not exists refunds_one_live_cancellation_per_payment
  on public.refunds (payment_id) where status <> 'failed' and kind = 'cancellation';
create unique index if not exists refunds_one_per_substitution
  on public.refunds (substitution_id) where substitution_id is not null and status <> 'failed';

-- Opening a cancellation refund returns what is still unrefunded of the
-- payment — the full amount, or less after a substitution was refunded.
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
  v_already  integer;
  v_amount   integer;
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

  select * into v_refund from public.refunds
   where payment_id = v_payment.id and status <> 'failed' and kind = 'cancellation';
  if found then
    return to_jsonb(v_refund);
  end if;

  select coalesce(sum(amount_paise), 0) into v_already from public.refunds
   where payment_id = v_payment.id and status <> 'failed';
  v_amount := v_payment.amount_paise - v_already;
  if v_amount <= 0 then
    return null;
  end if;

  v_method := case v_payment.provider when 'khata' then 'khata_credit' when 'cash' then 'cash' else 'provider' end;

  insert into public.refunds (
    order_id, payment_id, store_id, customer_id, amount_paise, currency,
    method, provider, reason, initiated_by, kind
  ) values (
    v_order.id, v_payment.id, v_order.store_id, v_order.customer_id, v_amount, v_payment.currency,
    v_method, case when v_method = 'provider' then v_payment.provider end,
    left(p_reason, 300), coalesce(p_initiated_by, 'system'), 'cancellation'
  )
  returning * into v_refund;

  insert into public.refund_events (refund_id, from_status, to_status, source, note)
  values (v_refund.id, null, 'initiated', 'system', 'Refund opened for order ' || v_order.order_number);

  if v_method = 'khata_credit' then
    select id into v_account from public.khata_accounts
     where customer_id = v_order.customer_id and store_id = v_order.store_id
       for update;
    insert into public.khata_transactions (
      account_id, type, amount_paise, description, order_id, entry_kind, recorded_by_type, refund_id
    ) values (
      v_account, 'credit', v_refund.amount_paise,
      'Refund for cancelled order ' || v_order.order_number, v_order.id, 'refund_credit', 'system', v_refund.id
    )
    returning id into v_txn;
    update public.refunds set khata_transaction_id = v_txn where id = v_refund.id;
    perform public.record_refund_update(jsonb_build_object(
      'refund_id', v_refund.id, 'to_status', 'refunded', 'source', 'system', 'note', 'Credited to khata'
    ));
    select * into v_refund from public.refunds where id = v_refund.id;
  end if;

  return to_jsonb(v_refund);
end;
$$;

revoke all on function public.initiate_order_refund(uuid, text, text) from public, anon, authenticated;
grant execute on function public.initiate_order_refund(uuid, text, text) to service_role;

-- record_refund_update, with one change: only a CANCELLATION refund being
-- confirmed makes the payment and order 'refunded'. A partial adjustment
-- leaves them 'paid' (the order still stands); it is listed beside them.
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

  if v_to = 'initiated' and v_refund.kind = 'cancellation' and exists (
    select 1 from public.refunds where payment_id = v_refund.payment_id and id <> v_refund.id
       and status <> 'failed' and kind = 'cancellation'
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

  if v_to = 'refunded' and v_refund.kind = 'cancellation' then
    update public.payments set status = 'refunded' where id = v_refund.payment_id;
    update public.orders set payment_status = 'refunded' where id = v_refund.order_id;
  end if;

  return jsonb_build_object('applied', true, 'refund_id', v_refund.id, 'status', v_to, 'from_status', v_refund.status);
end;
$$;

revoke all on function public.record_refund_update(jsonb) from public, anon, authenticated;
grant execute on function public.record_refund_update(jsonb) to service_role;

-- ── Applying an approved substitution ───────────────────────────────────────
-- In one transaction: the original line is marked replaced; the replacement
-- is added at the agreed price; the reservation moves from the old variant to
-- the new one (logged); the order's totals are recomputed; and if the order
-- was prepaid and now costs less, an adjustment refund is opened for the
-- difference (a khata one settles at once). Raises ORDER_LOCKED,
-- SUBSTITUTE_UNAVAILABLE, SUBSTITUTION_NOT_PENDING.
create or replace function public.apply_substitution(p_substitution_id uuid, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub       public.order_substitutions%rowtype;
  v_order     public.orders%rowtype;
  v_item      public.order_items%rowtype;
  v_product   record;
  v_held      integer;
  v_on_hand   integer;
  v_reserved  integer;
  v_new_item  uuid;
  v_line_sub  integer;
  v_line_tax  integer;
  v_subtotal  integer;
  v_tax       integer;
  v_discount  integer;
  v_new_total integer;
  v_payment   public.payments%rowtype;
  v_refunded  integer;
  v_diff      integer;
  v_refund    uuid;
  v_account   uuid;
  v_txn       uuid;
begin
  select * into v_sub from public.order_substitutions where id = p_substitution_id for update;
  if not found or v_sub.status <> 'pending' then
    raise exception 'SUBSTITUTION_NOT_PENDING' using errcode = 'P0001';
  end if;
  select * into v_order from public.orders where id = v_sub.order_id for update;
  if v_order.status not in ('placed', 'accepted', 'preparing') then
    raise exception 'ORDER_LOCKED' using errcode = 'P0001';
  end if;
  select * into v_item from public.order_items where id = v_sub.order_item_id for update;

  select p.id, p.track_inventory, p.tax_percent, v.quantity_on_hand, v.reserved_quantity
    into v_product
    from public.product_variants v join public.products p on p.id = v.product_id
   where v.id = v_sub.proposed_variant_id and p.store_id = v_order.store_id
     and p.is_available and p.archived_at is null and v.is_available
     for update of v;
  if not found or (v_product.track_inventory and v_product.quantity_on_hand - v_product.reserved_quantity < v_sub.proposed_quantity) then
    raise exception 'SUBSTITUTE_UNAVAILABLE' using errcode = 'P0001';
  end if;

  -- Release what the original line holds.
  select coalesce(sum(reserved_change), 0) into v_held from public.inventory_ledger
   where reference_type = 'order' and reference_id = v_order.id and variant_id = v_item.variant_id;
  v_held := least(v_held, v_item.quantity);
  if v_held > 0 then
    update public.product_variants set reserved_quantity = reserved_quantity - v_held
     where id = v_item.variant_id returning quantity_on_hand, reserved_quantity into v_on_hand, v_reserved;
    insert into public.inventory_ledger (store_id, product_id, variant_id, movement_type, on_hand_change, reserved_change,
      on_hand_after, reserved_after, reference_type, reference_id, performed_by_type, notes)
    values (v_order.store_id, v_item.product_id, v_item.variant_id, 'order_released', 0, -v_held, v_on_hand, v_reserved,
      'order', v_order.id, 'system', 'Substituted');
  end if;

  -- Hold the replacement.
  if v_product.track_inventory then
    update public.product_variants set reserved_quantity = reserved_quantity + v_sub.proposed_quantity
     where id = v_sub.proposed_variant_id returning quantity_on_hand, reserved_quantity into v_on_hand, v_reserved;
    insert into public.inventory_ledger (store_id, product_id, variant_id, movement_type, on_hand_change, reserved_change,
      on_hand_after, reserved_after, reference_type, reference_id, performed_by_type, notes)
    values (v_order.store_id, v_sub.proposed_product_id, v_sub.proposed_variant_id, 'order_reserved', 0, v_sub.proposed_quantity,
      v_on_hand, v_reserved, 'order', v_order.id, 'system', 'Substitute');
  end if;

  v_line_sub := v_sub.proposed_unit_price_paise * v_sub.proposed_quantity;
  v_line_tax := floor((v_line_sub * round(v_product.tax_percent * 100) + 5000) / 10000);

  update public.order_items set is_active = false, replaced_by_substitution_id = v_sub.id where id = v_item.id;
  insert into public.order_items (
    order_id, product_id, variant_id, product_name, variant_name, unit_price_paise, quantity,
    tax_percent, tax_paise, line_total_paise
  ) values (
    v_order.id, v_sub.proposed_product_id, v_sub.proposed_variant_id, v_sub.proposed_name, v_sub.proposed_variant_name,
    v_sub.proposed_unit_price_paise, v_sub.proposed_quantity, v_product.tax_percent, v_line_tax, v_line_sub + v_line_tax
  )
  returning id into v_new_item;

  select coalesce(sum(unit_price_paise * quantity), 0), coalesce(sum(tax_paise), 0) into v_subtotal, v_tax
    from public.order_items where order_id = v_order.id and is_active;
  v_discount := least(v_order.discount_paise, v_subtotal);
  v_new_total := v_subtotal - v_discount + v_order.delivery_fee_paise + v_tax;

  update public.orders
     set subtotal_paise = v_subtotal, discount_paise = v_discount, tax_paise = v_tax, total_paise = v_new_total
   where id = v_order.id;

  update public.order_substitutions
     set status = 'approved', responded_at = now(), new_order_item_id = v_new_item,
         auto_approved = (p_actor = 'system')
   where id = v_sub.id;

  -- A prepaid order that now costs less: the difference goes back.
  select * into v_payment from public.payments where order_id = v_order.id and status = 'paid'
   order by created_at desc limit 1;
  if found then
    select coalesce(sum(amount_paise), 0) into v_refunded from public.refunds
     where payment_id = v_payment.id and status <> 'failed';
    v_diff := v_payment.amount_paise - v_refunded - v_new_total;
    if v_diff > 0 then
      insert into public.refunds (order_id, payment_id, store_id, customer_id, amount_paise, currency, method, provider,
        reason, initiated_by, kind, substitution_id)
      values (v_order.id, v_payment.id, v_order.store_id, v_order.customer_id, v_diff, v_payment.currency,
        case v_payment.provider when 'khata' then 'khata_credit' when 'cash' then 'cash' else 'provider' end,
        case when v_payment.provider in ('khata', 'cash') then null else v_payment.provider end,
        'Substitution cost less', 'system', 'adjustment', v_sub.id)
      returning id into v_refund;
      insert into public.refund_events (refund_id, from_status, to_status, source, note)
      values (v_refund, null, 'initiated', 'system', 'Difference after a substitution');
      if v_payment.provider = 'khata' then
        select id into v_account from public.khata_accounts where customer_id = v_order.customer_id and store_id = v_order.store_id for update;
        insert into public.khata_transactions (account_id, type, amount_paise, description, order_id, entry_kind, recorded_by_type, refund_id)
        values (v_account, 'credit', v_diff, 'Substitution difference, order ' || v_order.order_number, v_order.id, 'refund_credit', 'system', v_refund)
        returning id into v_txn;
        update public.refunds set khata_transaction_id = v_txn where id = v_refund;
        perform public.record_refund_update(jsonb_build_object('refund_id', v_refund, 'to_status', 'refunded', 'source', 'system', 'note', 'Credited to khata'));
      end if;
    end if;
  end if;

  return jsonb_build_object('order_id', v_order.id, 'new_item_id', v_new_item, 'total_paise', v_new_total, 'refund_id', v_refund);
end;
$$;

revoke all on function public.apply_substitution(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_substitution(uuid, text) to service_role;

-- The fulfilment trigger (0030) takes from the shelf what the ledger says the
-- order holds, so a moved reservation is fulfilled from the substitute.

-- ── Scheduled work ──────────────────────────────────────────────────────────
-- A lease per job, so several app instances can run the scheduler and each
-- job still runs once at a time. A run log for every execution.
create table if not exists public.job_leases (
  job         text primary key,
  holder      text not null,
  lease_until timestamptz not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.job_runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running',
  summary     jsonb not null default '{}'::jsonb,
  error       text,

  constraint job_runs_status check (status in ('running', 'succeeded', 'failed')),
  constraint job_runs_error_len check (error is null or char_length(error) <= 1000)
);

create index if not exists job_runs_job_idx on public.job_runs (job, started_at desc);

drop trigger if exists job_leases_set_updated_at on public.job_leases;
create trigger job_leases_set_updated_at before update on public.job_leases
  for each row execute function public.set_updated_at();

alter table public.job_leases enable row level security;
alter table public.job_runs enable row level security;

create or replace function public.acquire_job_lease(p_job text, p_holder text, p_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.job_leases (job, holder, lease_until) values (p_job, p_holder, now() + make_interval(secs => p_seconds))
  on conflict (job) do update
     set holder = excluded.holder, lease_until = excluded.lease_until, updated_at = now()
   where public.job_leases.lease_until < now() or public.job_leases.holder = excluded.holder;
  return exists (select 1 from public.job_leases where job = p_job and holder = p_holder);
end;
$$;

revoke all on function public.acquire_job_lease(text, text, integer) from public, anon, authenticated;
grant execute on function public.acquire_job_lease(text, text, integer) to service_role;

-- Recurring operations a merchant schedules: a reminder of their own, or a
-- report the app prepares (low stock, expiry, purchase suggestions, overdue
-- khata). Times are in the store's timezone.
create table if not exists public.recurring_tasks (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores (id) on delete cascade,
  title         text not null,
  task_type     text not null,
  frequency     text not null,
  day_of_week   smallint,
  day_of_month  smallint,
  time_of_day   text not null default '09:00',
  is_active     boolean not null default true,
  next_run_at   timestamptz not null,
  last_run_at   timestamptz,
  created_by    uuid references public.merchants (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint recurring_tasks_title_len check (char_length(title) between 1 and 120),
  constraint recurring_tasks_type check (task_type in ('reminder', 'low_stock_report', 'expiry_report', 'purchase_suggestions', 'khata_overdue_report')),
  constraint recurring_tasks_frequency check (frequency in ('daily', 'weekly', 'monthly')),
  constraint recurring_tasks_day_of_week check (day_of_week is null or day_of_week between 0 and 6),
  constraint recurring_tasks_day_of_month check (day_of_month is null or day_of_month between 1 and 28),
  constraint recurring_tasks_time check (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint recurring_tasks_schedule check (
    (frequency = 'daily') or (frequency = 'weekly' and day_of_week is not null) or (frequency = 'monthly' and day_of_month is not null)
  )
);

create index if not exists recurring_tasks_store_id_idx on public.recurring_tasks (store_id);
create index if not exists recurring_tasks_created_by_idx on public.recurring_tasks (created_by);
create index if not exists recurring_tasks_due_idx on public.recurring_tasks (next_run_at) where is_active;

drop trigger if exists recurring_tasks_set_updated_at on public.recurring_tasks;
create trigger recurring_tasks_set_updated_at before update on public.recurring_tasks
  for each row execute function public.set_updated_at();

alter table public.recurring_tasks enable row level security;
drop policy if exists recurring_tasks_select_owner on public.recurring_tasks;
create policy recurring_tasks_select_owner on public.recurring_tasks for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));

-- Automatic weekly khata reminders are the merchant's choice, off by default.
alter table public.stores add column if not exists khata_auto_reminders boolean not null default false;

-- Customer reminders sent (reorder, template), so each is sent once per cycle.
create table if not exists public.customer_reminders (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  store_id    uuid not null references public.stores (id) on delete cascade,
  product_id  uuid references public.products (id) on delete cascade,
  list_id     uuid references public.shopping_lists (id) on delete cascade,
  kind        text not null,
  due_on      date not null,
  created_at  timestamptz not null default now(),

  constraint customer_reminders_kind check (kind in ('reorder', 'template'))
);

create unique index if not exists customer_reminders_once
  on public.customer_reminders (customer_id, store_id, kind, coalesce(product_id, list_id), due_on);
create index if not exists customer_reminders_customer_id_idx on public.customer_reminders (customer_id);
create index if not exists customer_reminders_store_id_idx on public.customer_reminders (store_id);
create index if not exists customer_reminders_product_id_idx on public.customer_reminders (product_id);
create index if not exists customer_reminders_list_id_idx on public.customer_reminders (list_id);

alter table public.customer_reminders enable row level security;
drop policy if exists customer_reminders_select_own on public.customer_reminders;
create policy customer_reminders_select_own on public.customer_reminders for select to authenticated
  using (customer_id = (select auth.uid()));

-- delete_store also clears what refers to the store's orders from outside it.
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
  if exists (select 1 from orders where store_id = p_store_id and status not in ('completed', 'cancelled', 'rejected')) then
    raise exception 'ORDERS_IN_PROGRESS' using errcode = 'P0001';
  end if;
  if exists (select 1 from refunds where store_id = p_store_id and status in ('initiated', 'processing')) then
    raise exception 'REFUNDS_IN_PROGRESS' using errcode = 'P0001';
  end if;

  perform set_config('cpse.deleting_store', 'on', true);

  update refunds set khata_transaction_id = null where store_id = p_store_id;
  delete from khata_transactions t using khata_accounts a
   where a.id = t.account_id and a.store_id = p_store_id and t.refund_id is not null;
  delete from refunds where store_id = p_store_id;
  delete from order_substitutions where store_id = p_store_id;
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
