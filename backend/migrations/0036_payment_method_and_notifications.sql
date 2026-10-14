-- 0036_payment_method_and_notifications.sql — how an order is paid becomes a
-- column, cash orders are settled when they complete, and notifications reach
-- merchants as well as customers, with their delivery tracked.
--
-- Roadmap §5 Payment / Payment confirmation, Phase C Notifications, §5 P5
-- Notification reliability.

-- ── 1. orders.payment_method ────────────────────────────────────────────────
-- Until now "online" was inferred from a payments row existing. That stops
-- working the moment a cash order is settled (it gains a payments row too) or a
-- khata order exists, so the method is recorded at checkout instead.
alter table public.orders
  add column if not exists payment_method text;

update public.orders o
   set payment_method = case
         when exists (select 1 from public.payments p where p.order_id = o.id) then 'online'
         else 'cash'
       end
 where o.payment_method is null;

alter table public.orders alter column payment_method set default 'cash';
alter table public.orders alter column payment_method set not null;

do $$ begin
  alter table public.orders
    add constraint orders_payment_method check (payment_method in ('cash', 'online', 'khata'));
exception when duplicate_object then null; end $$;

-- Who ended the order, written in the same update as the status, so the refund
-- trigger (0038) can attribute the refund without a second round trip.
alter table public.orders
  add column if not exists cancelled_by text;

do $$ begin
  alter table public.orders
    add constraint orders_cancelled_by check (
      cancelled_by is null or cancelled_by in ('customer', 'store', 'system', 'payment_webhook')
    );
exception when duplicate_object then null; end $$;

-- payments.provider now also names the non-gateway ways an order is settled.
do $$ begin
  alter table public.payments
    add constraint payments_provider_known check (provider in ('mock', 'razorpay', 'cash', 'khata'));
exception when duplicate_object then null; end $$;

-- ── 2. Settling cash orders ─────────────────────────────────────────────────
-- A cash order is paid at the counter or the door. Completing it is the
-- merchant confirming the money changed hands, so its payment_status becomes
-- 'paid' in the same statement, and a cash payments row records the receipt.
-- A cash order that ends any other way was never paid: 'cancelled'.
create or replace function public.settle_order_payment_status()
returns trigger
language plpgsql
as $$
begin
  if new.payment_method = 'cash' and new.payment_status = 'pending' then
    if new.status = 'completed' then
      new.payment_status := 'paid';
    elsif new.status in ('cancelled', 'rejected') then
      new.payment_status := 'cancelled';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_settle_payment_status on public.orders;
create trigger orders_settle_payment_status
  before update of status on public.orders
  for each row
  when (old.status is distinct from new.status)
  execute function public.settle_order_payment_status();

create or replace function public.record_cash_payment()
returns trigger
language plpgsql
as $$
begin
  if new.payment_method = 'cash' and new.status = 'completed'
     and new.payment_status = 'paid' and new.total_paise > 0
     and not exists (select 1 from public.payments p where p.order_id = new.id and p.provider = 'cash') then
    insert into public.payments (order_id, provider, amount_paise, currency, status, paid_at, raw_payload)
    values (new.id, 'cash', new.total_paise, 'INR', 'paid', now(),
            jsonb_build_object('source', 'order_completed'));
  end if;
  return null;
end;
$$;

drop trigger if exists orders_record_cash_payment on public.orders;
create trigger orders_record_cash_payment
  after update of status on public.orders
  for each row
  when (old.status is distinct from new.status and new.status = 'completed')
  execute function public.record_cash_payment();

-- ── 3. Notification types become an open, checked list ──────────────────────
-- The enum from 0001 cannot grow inside the transaction that first uses a new
-- value, and every phase of the roadmap adds events. A checked text column
-- keeps the same guarantee and can be extended by the migration that needs it.
alter table public.notifications alter column type type text using type::text;

alter table public.notifications drop constraint if exists notifications_type_known;
alter table public.notifications
  add constraint notifications_type_known check (type in (
    'order_placed', 'order_status_changed', 'order_cancelled',
    'payment_succeeded', 'payment_failed',
    'refund_initiated', 'refund_processing', 'refund_completed', 'refund_failed',
    'khata_updated', 'khata_reminder',
    'loyalty_updated', 'offer', 'message', 'reorder_reminder', 'support_update',
    'substitution_requested', 'store_update'
  ));

-- ── 4. Merchant notifications ───────────────────────────────────────────────
-- A store's inbox: new orders, refunds that need attention, low stock, expiry,
-- customer messages. Per store, readable by its owner.
create table if not exists public.merchant_notifications (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id) on delete cascade,
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  payload     jsonb not null default '{}'::jsonb,
  -- Collapses repeats of the same condition (e.g. one low-stock alert per
  -- variant per day) so a re-run of a job does not flood the inbox.
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),

  constraint merchant_notifications_title_len check (char_length(title) between 1 and 200),
  constraint merchant_notifications_type_known check (type in (
    'order_placed', 'order_cancelled', 'payment_received',
    'refund_initiated', 'refund_completed', 'refund_failed',
    'low_stock', 'batch_expiring', 'batch_expired', 'offer_ended',
    'message', 'special_request', 'support_ticket', 'verification_update',
    'khata_due', 'recurring_task', 'substitution_response'
  ))
);

create index if not exists merchant_notifications_store_created_idx
  on public.merchant_notifications (store_id, created_at desc);
create index if not exists merchant_notifications_merchant_id_idx
  on public.merchant_notifications (merchant_id);
create index if not exists merchant_notifications_unread_idx
  on public.merchant_notifications (store_id) where read_at is null;
create unique index if not exists merchant_notifications_dedupe_key
  on public.merchant_notifications (store_id, dedupe_key) where dedupe_key is not null;

alter table public.merchant_notifications enable row level security;

drop policy if exists merchant_notifications_select_owner on public.merchant_notifications;
create policy merchant_notifications_select_owner on public.merchant_notifications
  for select to authenticated using (merchant_id = (select auth.uid()));

-- ── 5. Delivery tracking ────────────────────────────────────────────────────
-- In-app delivery is the row itself. Every other channel (email, SMS,
-- WhatsApp, push) is attempted through a provider and its outcome recorded
-- here — including 'skipped' when no provider is configured or the recipient
-- has not consented, so "why did I not get a text?" has an answer.
create table if not exists public.notification_deliveries (
  id                       uuid primary key default gen_random_uuid(),
  notification_id          uuid references public.notifications (id) on delete cascade,
  merchant_notification_id uuid references public.merchant_notifications (id) on delete cascade,
  channel                  text not null,
  status                   text not null default 'pending',
  attempts                 integer not null default 0,
  last_error               text,
  provider_ref             text,
  next_attempt_at          timestamptz,
  delivered_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint notification_deliveries_one_parent check (
    (notification_id is null) <> (merchant_notification_id is null)
  ),
  constraint notification_deliveries_channel check (channel in ('in_app', 'email', 'sms', 'whatsapp', 'push')),
  constraint notification_deliveries_status check (status in ('pending', 'sent', 'delivered', 'failed', 'skipped')),
  constraint notification_deliveries_attempts_nonneg check (attempts >= 0)
);

create index if not exists notification_deliveries_notification_id_idx
  on public.notification_deliveries (notification_id);
create index if not exists notification_deliveries_merchant_notification_id_idx
  on public.notification_deliveries (merchant_notification_id);
create index if not exists notification_deliveries_pending_idx
  on public.notification_deliveries (next_attempt_at) where status in ('pending', 'failed');

drop trigger if exists notification_deliveries_set_updated_at on public.notification_deliveries;
create trigger notification_deliveries_set_updated_at
  before update on public.notification_deliveries
  for each row execute function public.set_updated_at();

alter table public.notification_deliveries enable row level security;
