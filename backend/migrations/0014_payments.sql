-- 0014_payments.sql — Checklist 1.12.
-- Provider-agnostic by design (decision D7): the mock provider and a real
-- gateway both write the same three columns plus their raw payload.

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  provider      text not null default 'mock',
  -- The gateway's own id for this attempt. Unique per provider so a replayed
  -- webhook cannot create a second payment row (spec §17).
  provider_ref  text,
  amount_paise  integer not null,
  currency      text not null default 'INR',
  status        payment_status not null default 'pending',
  -- Whole gateway response, kept for debugging and reconciliation.
  raw_payload   jsonb not null default '{}'::jsonb,
  failure_reason text,
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint payments_amount_positive check (amount_paise > 0),
  constraint payments_currency_format check (currency ~ '^[A-Z]{3}$')
);

create index if not exists payments_order_id_idx on public.payments (order_id);
create index if not exists payments_status_idx   on public.payments (status);
create unique index if not exists payments_provider_ref_key
  on public.payments (provider, provider_ref) where provider_ref is not null;

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();
