-- 0041_customer_relationship.sql — what the customer saves, what they agree
-- to, what they do, and what the merchant notes about them.
--
-- Roadmap §5 P1 Customer profile; P2 Customer Effort Reduction (favourites,
-- shopping lists and templates, saved payment and delivery preferences,
-- recently viewed); P3 Communication preferences; P4 Occasion offers
-- (consent); P6 Behaviour events; §4 P2 Merchant CRM (per-merchant records,
-- communication preferences).
--
-- Consent is the customer's and is checked by every sender. Transactional
-- messages about an order the customer placed are always delivered in the
-- app; anything promotional needs the matching opt-in.

-- ── Profile additions ───────────────────────────────────────────────────────
-- A birthday is month and day only: enough for an occasion offer, and not a
-- date of birth.
alter table public.customers add column if not exists birthday_month smallint;
alter table public.customers add column if not exists birthday_day smallint;
-- Recording views and searches to personalise the app. Off means none are
-- recorded and nothing is personalised from them; purchases still drive
-- "buy again", because those are the customer's own orders.
alter table public.customers add column if not exists activity_tracking boolean not null default true;
alter table public.customers add column if not exists occasion_offers boolean not null default false;
-- Saved checkout choices. A payment PREFERENCE only — a method name, never a
-- card number, UPI handle or any credential.
alter table public.customers add column if not exists preferred_fulfilment fulfilment_mode;
alter table public.customers add column if not exists preferred_payment_method text;
alter table public.customers add column if not exists preferred_substitution text not null default 'contact_me';
alter table public.customers add column if not exists preferred_language text;

do $$ begin
  alter table public.customers
    add constraint customers_birthday_valid check (
      (birthday_month is null and birthday_day is null)
      or (birthday_month between 1 and 12 and birthday_day between 1 and 31)
    );
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.customers
    add constraint customers_preferred_payment check (
      preferred_payment_method is null or preferred_payment_method in ('cash', 'online', 'khata')
    );
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.customers
    add constraint customers_preferred_substitution check (
      preferred_substitution in ('contact_me', 'allow_similar', 'no_substitutions')
    );
exception when duplicate_object then null; end $$;

-- ── Per-store communication preferences ─────────────────────────────────────
create table if not exists public.customer_store_preferences (
  customer_id        uuid not null references public.customers (id) on delete cascade,
  store_id           uuid not null references public.stores (id) on delete cascade,
  -- Offers, announcements and occasion offers from this store.
  allow_promotions   boolean not null default false,
  -- Reorder reminders and khata reminders from this store.
  allow_reminders    boolean not null default true,
  -- Channels beyond the app. Each needs a delivery provider to mean anything.
  allow_sms          boolean not null default false,
  allow_whatsapp     boolean not null default false,
  allow_email        boolean not null default false,
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now(),

  primary key (customer_id, store_id)
);

create index if not exists customer_store_preferences_store_id_idx on public.customer_store_preferences (store_id);

drop trigger if exists customer_store_preferences_set_updated_at on public.customer_store_preferences;
create trigger customer_store_preferences_set_updated_at before update on public.customer_store_preferences
  for each row execute function public.set_updated_at();

-- ── Favourites ──────────────────────────────────────────────────────────────
create table if not exists public.favourite_products (
  customer_id uuid not null references public.customers (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  store_id    uuid not null references public.stores (id) on delete cascade,
  created_at  timestamptz not null default now(),

  primary key (customer_id, product_id)
);

create index if not exists favourite_products_product_id_idx on public.favourite_products (product_id);
create index if not exists favourite_products_store_id_idx on public.favourite_products (store_id, customer_id);

-- ── Shopping lists and templates ────────────────────────────────────────────
-- A list is items to buy later; a template is a basket bought again and again
-- ("weekly groceries"), optionally with a reminder rhythm.
create table if not exists public.shopping_lists (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers (id) on delete cascade,
  store_id      uuid references public.stores (id) on delete cascade,
  kind          text not null default 'list',
  name          text not null,
  repeat_every_days integer,
  next_reminder_on  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint shopping_lists_kind check (kind in ('list', 'template')),
  constraint shopping_lists_name_len check (char_length(name) between 1 and 80),
  constraint shopping_lists_repeat_range check (repeat_every_days is null or repeat_every_days between 1 and 90),
  constraint shopping_lists_template_store check (kind = 'list' or store_id is not null)
);

create index if not exists shopping_lists_customer_id_idx on public.shopping_lists (customer_id, updated_at desc);
create index if not exists shopping_lists_store_id_idx on public.shopping_lists (store_id);

drop trigger if exists shopping_lists_set_updated_at on public.shopping_lists;
create trigger shopping_lists_set_updated_at before update on public.shopping_lists
  for each row execute function public.set_updated_at();

create table if not exists public.shopping_list_items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.shopping_lists (id) on delete cascade,
  product_id  uuid references public.products (id) on delete cascade,
  variant_id  uuid references public.product_variants (id) on delete cascade,
  -- A free-text line ("bread, any brand") for a list not tied to a product.
  label       text,
  quantity    integer not null default 1,
  note        text,
  is_checked  boolean not null default false,
  created_at  timestamptz not null default now(),

  constraint shopping_list_items_what check (product_id is not null or label is not null),
  constraint shopping_list_items_quantity check (quantity between 1 and 999),
  constraint shopping_list_items_label_len check (label is null or char_length(label) between 1 and 120),
  constraint shopping_list_items_note_len check (note is null or char_length(note) <= 200)
);

create index if not exists shopping_list_items_list_id_idx on public.shopping_list_items (list_id);
create index if not exists shopping_list_items_product_id_idx on public.shopping_list_items (product_id);
create index if not exists shopping_list_items_variant_id_idx on public.shopping_list_items (variant_id);

-- ── Behaviour events ────────────────────────────────────────────────────────
-- Structured signals for "recently viewed", metrics and later personalisation.
-- Only for signed-in customers who have tracking on; purchases and carts are
-- read from their own tables, not duplicated here.
create table if not exists public.customer_events (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  store_id    uuid references public.stores (id) on delete cascade,
  product_id  uuid references public.products (id) on delete cascade,
  variant_id  uuid references public.product_variants (id) on delete set null,
  order_id    uuid references public.orders (id) on delete set null,
  event_type  text not null,
  query       text,
  session_id  text,
  properties  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),

  constraint customer_events_type check (event_type in (
    'store_view', 'product_view', 'search', 'cart_add', 'cart_remove', 'checkout_start',
    'favourite_add', 'favourite_remove', 'store_save', 'list_add', 'offer_view', 'assistant_query'
  )),
  constraint customer_events_query_len check (query is null or char_length(query) <= 200),
  constraint customer_events_session_len check (session_id is null or char_length(session_id) <= 100)
);

create index if not exists customer_events_customer_id_idx on public.customer_events (customer_id, created_at desc);
create index if not exists customer_events_store_id_idx on public.customer_events (store_id, created_at desc);
create index if not exists customer_events_product_id_idx on public.customer_events (product_id);
create index if not exists customer_events_variant_id_idx on public.customer_events (variant_id);
create index if not exists customer_events_order_id_idx on public.customer_events (order_id);

-- ── The merchant's own notes on a customer ──────────────────────────────────
-- Everything a merchant knows about a customer's purchases is computed from
-- transactions; this table holds only what the merchant writes down.
create table if not exists public.store_customer_notes (
  store_id    uuid not null references public.stores (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  notes       text,
  tags        text[] not null default '{}',
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),

  primary key (store_id, customer_id),
  constraint store_customer_notes_len check (notes is null or char_length(notes) <= 1000),
  constraint store_customer_notes_tags check (cardinality(tags) <= 10)
);

create index if not exists store_customer_notes_customer_id_idx on public.store_customer_notes (customer_id);

drop trigger if exists store_customer_notes_set_updated_at on public.store_customer_notes;
create trigger store_customer_notes_set_updated_at before update on public.store_customer_notes
  for each row execute function public.set_updated_at();

-- ── Row level security ──────────────────────────────────────────────────────
alter table public.customer_store_preferences enable row level security;
alter table public.favourite_products enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.shopping_list_items enable row level security;
alter table public.customer_events enable row level security;
alter table public.store_customer_notes enable row level security;

drop policy if exists customer_store_preferences_all_own on public.customer_store_preferences;
create policy customer_store_preferences_all_own on public.customer_store_preferences
  for all to authenticated
  using (customer_id = (select auth.uid())) with check (customer_id = (select auth.uid()));

drop policy if exists favourite_products_all_own on public.favourite_products;
create policy favourite_products_all_own on public.favourite_products
  for all to authenticated
  using (customer_id = (select auth.uid())) with check (customer_id = (select auth.uid()));

drop policy if exists shopping_lists_all_own on public.shopping_lists;
create policy shopping_lists_all_own on public.shopping_lists
  for all to authenticated
  using (customer_id = (select auth.uid())) with check (customer_id = (select auth.uid()));

drop policy if exists shopping_list_items_all_own on public.shopping_list_items;
create policy shopping_list_items_all_own on public.shopping_list_items
  for all to authenticated
  using (exists (select 1 from public.shopping_lists l where l.id = list_id and l.customer_id = (select auth.uid())))
  with check (exists (select 1 from public.shopping_lists l where l.id = list_id and l.customer_id = (select auth.uid())));

drop policy if exists customer_events_select_own on public.customer_events;
create policy customer_events_select_own on public.customer_events
  for select to authenticated using (customer_id = (select auth.uid()));

drop policy if exists store_customer_notes_owner on public.store_customer_notes;
create policy store_customer_notes_owner on public.store_customer_notes
  for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));
