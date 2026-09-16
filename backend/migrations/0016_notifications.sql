-- 0016_notifications.sql — Checklist 1.14.
-- In-app only. The spec rules out separate notification infrastructure, so
-- there is no push/email fan-out here: rows are written by the API and polled
-- by the client.

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  type        notification_type not null,
  title       text not null,
  body        text,
  -- Deep-link context, e.g. {"order_id": "...", "order_number": "CPSE-..."}.
  payload     jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),

  constraint notifications_title_len check (char_length(title) between 1 and 200)
);

create index if not exists notifications_customer_id_idx on public.notifications (customer_id);
create index if not exists notifications_customer_created_idx
  on public.notifications (customer_id, created_at desc);
-- Powers the unread badge without scanning the customer's whole history.
create index if not exists notifications_unread_idx
  on public.notifications (customer_id) where read_at is null;
