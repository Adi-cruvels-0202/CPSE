-- 0048 — run the shop from WhatsApp.
--
-- A shop owner links one WhatsApp number to their account, proving it is
-- theirs by sending a one-time code from that number to the CPSE business
-- number. Once linked, messages from that number act as that shop owner:
-- open orders, sales, stock, order actions and new-order alerts.
--
-- Only the server (service role) reads or writes these tables; there are no
-- policies for signed-in users. Idempotent.

create table if not exists public.merchant_whatsapp_links (
  merchant_id           uuid primary key references public.merchants (id) on delete cascade,
  -- Digits only, with the country code, the way WhatsApp sends it: 919876543210.
  phone                 text not null,
  status                text not null default 'pending',
  link_code_hash        text,
  link_code_expires_at  timestamptz,
  link_attempts         integer not null default 0,
  -- The shop the messages are about, for an owner with more than one.
  active_store_id       uuid references public.stores (id) on delete set null,
  notify_orders         boolean not null default true,
  -- WhatsApp allows free-form messages for 24 hours after the owner last wrote.
  last_inbound_at       timestamptz,
  linked_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint merchant_whatsapp_links_phone_format check (phone ~ '^[1-9][0-9]{7,14}$'),
  constraint merchant_whatsapp_links_status check (status in ('pending', 'active')),
  constraint merchant_whatsapp_links_attempts check (link_attempts >= 0)
);

-- One account per number, so a message always means one shop owner.
create unique index if not exists merchant_whatsapp_links_phone_key on public.merchant_whatsapp_links (phone);

create index if not exists merchant_whatsapp_links_active_store_idx on public.merchant_whatsapp_links (active_store_id);

drop trigger if exists merchant_whatsapp_links_set_updated_at on public.merchant_whatsapp_links;
create trigger merchant_whatsapp_links_set_updated_at before update on public.merchant_whatsapp_links
  for each row execute function public.set_updated_at();

alter table public.merchant_whatsapp_links enable row level security;

-- Every message in and out, for support ("why didn't I get the alert?") and so
-- a message WhatsApp delivers twice is handled once.
create table if not exists public.whatsapp_messages (
  id              uuid primary key default gen_random_uuid(),
  direction       text not null,
  phone           text not null,
  merchant_id     uuid references public.merchants (id) on delete set null,
  wa_message_id   text,
  kind            text not null,
  body            text,
  status          text not null,
  error           text,
  created_at      timestamptz not null default now(),
  constraint whatsapp_messages_direction check (direction in ('in', 'out')),
  constraint whatsapp_messages_status check (status in ('received', 'sent', 'failed', 'skipped'))
);

create unique index if not exists whatsapp_messages_inbound_key
  on public.whatsapp_messages (wa_message_id) where direction = 'in';
create index if not exists whatsapp_messages_merchant_idx on public.whatsapp_messages (merchant_id, created_at desc);

alter table public.whatsapp_messages enable row level security;
