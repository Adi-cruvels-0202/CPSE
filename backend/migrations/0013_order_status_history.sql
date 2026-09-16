-- 0013_order_status_history.sql — Checklist 1.11.
-- Append-only audit of every state transition, so "when did this become
-- ready?" is answerable and illegal transitions are traceable after the fact.

create table if not exists public.order_status_history (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  from_status order_status,                 -- null on the first entry
  to_status   order_status not null,
  note        text,
  -- Who caused it: 'customer', 'store', 'system', 'payment_webhook'.
  changed_by  text not null default 'system',
  created_at  timestamptz not null default now(),

  constraint order_status_history_changed_by
    check (changed_by in ('customer', 'store', 'system', 'payment_webhook')),
  constraint order_status_history_no_self_transition
    check (from_status is null or from_status <> to_status)
);

create index if not exists order_status_history_order_id_idx
  on public.order_status_history (order_id, created_at);
