-- 0037_khata_merchant_ledger.sql — the merchant runs the khata.
--
-- Roadmap §4 P2: Digital Khata, Khata statements, Due dates & reminders,
-- Audit-safe records, Khata refund/adjustment link; §6 Khata flow.
--
-- Until now the ledger was customer read-only and filled by seed data. Here the
-- merchant gets a controlled way to write it — and the rules that make it an
-- audit trail rather than a number someone can edit:
--
--   * entries are immutable (0017) and now also undeletable, outside the
--     store-deletion function that removes a whole store;
--   * a correction is a REVERSAL entry pointing at the entry it cancels, never
--     an edit; an entry can be reversed once;
--   * every entry says who recorded it and what kind of event it was;
--   * due dates live on the charge, reminders in their own table — following
--     up never touches the ledger.
--
-- It also lets a customer buy on khata at checkout, where the store allows it:
-- create_order charges the account in the same transaction as the order.

-- ── Accounts ────────────────────────────────────────────────────────────────

-- null = this customer may not buy on credit at checkout (the merchant can still
-- record charges by hand). 0 is a limit of zero, which also refuses.
alter table public.khata_accounts add column if not exists credit_limit_paise integer;
alter table public.khata_accounts add column if not exists is_active boolean not null default true;
alter table public.khata_accounts add column if not exists notes text;
alter table public.khata_accounts add column if not exists reminders_enabled boolean not null default true;
-- Who opened it, for the audit trail; null for accounts that predate this.
alter table public.khata_accounts add column if not exists opened_by uuid references public.merchants (id) on delete set null;

do $$ begin
  alter table public.khata_accounts
    add constraint khata_accounts_credit_limit_nonneg check (credit_limit_paise is null or credit_limit_paise >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.khata_accounts
    add constraint khata_accounts_notes_len check (notes is null or char_length(notes) <= 500);
exception when duplicate_object then null; end $$;

create index if not exists khata_accounts_opened_by_idx on public.khata_accounts (opened_by);

-- Store-level khata settings.
alter table public.stores add column if not exists khata_enabled boolean not null default false;
alter table public.stores add column if not exists khata_due_days integer not null default 30;

do $$ begin
  alter table public.stores
    add constraint stores_khata_due_days_range check (khata_due_days between 0 and 365);
exception when duplicate_object then null; end $$;

-- ── Entries ─────────────────────────────────────────────────────────────────

alter table public.khata_transactions add column if not exists entry_kind text;
update public.khata_transactions
   set entry_kind = case when type = 'debit' then 'charge' else 'payment' end
 where entry_kind is null;
alter table public.khata_transactions alter column entry_kind set not null;

-- Writers that predate entry kinds (the seed, direct inserts) name only the
-- direction; a charge or a payment is what they meant.
create or replace function public.default_khata_entry_kind()
returns trigger
language plpgsql
as $$
begin
  if new.entry_kind is null then
    new.entry_kind := case when new.type = 'debit' then 'charge' else 'payment' end;
  end if;
  return new;
end;
$$;

drop trigger if exists khata_transactions_default_kind on public.khata_transactions;
create trigger khata_transactions_default_kind
  before insert on public.khata_transactions
  for each row execute function public.default_khata_entry_kind();

do $$ begin
  alter table public.khata_transactions
    add constraint khata_transactions_entry_kind check (
      entry_kind in ('charge', 'payment', 'adjustment', 'reversal', 'refund_credit')
    );
exception when duplicate_object then null; end $$;

-- A charge owes, a payment repays: the kind has to agree with the direction.
-- Adjustments and reversals may go either way.
do $$ begin
  alter table public.khata_transactions
    add constraint khata_transactions_kind_direction check (
      (entry_kind = 'charge' and type = 'debit')
      or (entry_kind in ('payment', 'refund_credit') and type = 'credit')
      or entry_kind in ('adjustment', 'reversal')
    );
exception when duplicate_object then null; end $$;

alter table public.khata_transactions add column if not exists due_date date;
alter table public.khata_transactions add column if not exists payment_method text;
alter table public.khata_transactions
  add column if not exists reverses_transaction_id uuid references public.khata_transactions (id) on delete no action;
alter table public.khata_transactions add column if not exists recorded_by_type text not null default 'system';
alter table public.khata_transactions add column if not exists recorded_by_id uuid;
alter table public.khata_transactions add column if not exists idempotency_key text;

do $$ begin
  alter table public.khata_transactions
    add constraint khata_transactions_payment_method check (
      payment_method is null or payment_method in ('cash', 'upi', 'card', 'bank_transfer', 'other')
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.khata_transactions
    add constraint khata_transactions_recorded_by check (recorded_by_type in ('merchant', 'customer', 'system'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.khata_transactions
    add constraint khata_transactions_reversal_target check (
      (entry_kind = 'reversal') = (reverses_transaction_id is not null)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.khata_transactions
    add constraint khata_transactions_description_len check (description is null or char_length(description) <= 300);
exception when duplicate_object then null; end $$;

-- An entry is reversed at most once.
create unique index if not exists khata_transactions_one_reversal
  on public.khata_transactions (reverses_transaction_id) where reverses_transaction_id is not null;
create unique index if not exists khata_transactions_idempotency_key
  on public.khata_transactions (account_id, idempotency_key) where idempotency_key is not null;
create index if not exists khata_transactions_due_idx
  on public.khata_transactions (due_date) where due_date is not null;

-- Undeletable, like the inventory ledger — except while delete_store removes a
-- whole store (0035 sets the flag for its own transaction).
create or replace function public.reject_khata_transaction_delete()
returns trigger
language plpgsql
as $$
begin
  if current_setting('cpse.deleting_store', true) = 'on' then
    return old;
  end if;
  raise exception 'khata_transactions rows are permanent; record a reversal instead';
end;
$$;

drop trigger if exists khata_transactions_undeletable on public.khata_transactions;
create trigger khata_transactions_undeletable
  before delete on public.khata_transactions
  for each row execute function public.reject_khata_transaction_delete();

-- ── Reminders: follow-up, never a ledger change ─────────────────────────────
create table if not exists public.khata_reminders (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.khata_accounts (id) on delete cascade,
  -- What was owed and when, as the reminder said it — a snapshot.
  outstanding_paise integer not null,
  overdue_paise    integer not null default 0,
  earliest_due_date date,
  channel          text not null default 'in_app',
  sent_by_type     text not null,
  sent_by_id       uuid,
  note             text,
  created_at       timestamptz not null default now(),

  constraint khata_reminders_amounts_nonneg check (outstanding_paise >= 0 and overdue_paise >= 0),
  constraint khata_reminders_channel check (channel in ('in_app', 'sms', 'whatsapp', 'email')),
  constraint khata_reminders_sent_by check (sent_by_type in ('merchant', 'system')),
  constraint khata_reminders_note_len check (note is null or char_length(note) <= 300)
);

create index if not exists khata_reminders_account_id_idx on public.khata_reminders (account_id, created_at desc);

alter table public.khata_reminders enable row level security;

drop policy if exists khata_reminders_select_own on public.khata_reminders;
create policy khata_reminders_select_own on public.khata_reminders
  for select to authenticated
  using (exists (select 1 from public.khata_accounts a
                  where a.id = account_id and a.customer_id = (select auth.uid())));

-- Merchants read the khata of their own stores.
drop policy if exists khata_accounts_select_owner on public.khata_accounts;
create policy khata_accounts_select_owner on public.khata_accounts
  for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));

drop policy if exists khata_transactions_select_owner on public.khata_transactions;
create policy khata_transactions_select_owner on public.khata_transactions
  for select to authenticated
  using (exists (select 1 from public.khata_accounts a
                   join public.stores s on s.id = a.store_id
                  where a.id = account_id and s.owner_id = (select auth.uid())));

-- ── The one writer of merchant khata entries ────────────────────────────────
-- payload: { account_id, store_id, merchant_id, entry_kind, direction?,
--            amount_paise, description, due_date, payment_method,
--            reverses_transaction_id, order_id, idempotency_key, occurred_at }
--   entry_kind 'charge'     → debit
--              'payment'    → credit
--              'adjustment' → `direction` 'debit' | 'credit', description required
--              'reversal'   → the opposite of the entry it reverses, same amount
-- Returns { transaction_id, replayed }.
-- Raises ACCOUNT_NOT_FOUND, ACCOUNT_CLOSED, ENTRY_NOT_FOUND, ALREADY_REVERSED,
-- CANNOT_REVERSE_REVERSAL, REASON_REQUIRED, ORDER_NOT_FOUND.
create or replace function public.record_khata_entry(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid := (payload ->> 'account_id')::uuid;
  v_store_id   uuid := (payload ->> 'store_id')::uuid;
  v_kind       text := payload ->> 'entry_kind';
  v_key        text := nullif(payload ->> 'idempotency_key', '');
  v_amount     integer := (payload ->> 'amount_paise')::integer;
  v_type       khata_txn_type;
  v_account    record;
  v_original   record;
  v_order_id   uuid := nullif(payload ->> 'order_id', '')::uuid;
  v_reverses   uuid;
  v_id         uuid;
begin
  select * into v_account from public.khata_accounts
   where id = v_account_id and store_id = v_store_id
     for update;
  if not found then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_key is not null then
    select id into v_id from public.khata_transactions where account_id = v_account_id and idempotency_key = v_key;
    if found then
      return jsonb_build_object('transaction_id', v_id, 'replayed', true);
    end if;
  end if;

  -- A closed account still accepts what settles it: payments and corrections.
  if not v_account.is_active and v_kind = 'charge' then
    raise exception 'ACCOUNT_CLOSED' using errcode = 'P0001';
  end if;

  if v_order_id is not null and not exists (
    select 1 from public.orders where id = v_order_id and store_id = v_store_id and customer_id = v_account.customer_id
  ) then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_kind = 'charge' then
    v_type := 'debit';
  elsif v_kind = 'payment' then
    v_type := 'credit';
  elsif v_kind = 'adjustment' then
    if coalesce(trim(payload ->> 'description'), '') = '' then
      raise exception 'REASON_REQUIRED' using errcode = 'P0001';
    end if;
    v_type := (payload ->> 'direction')::khata_txn_type;
  elsif v_kind = 'reversal' then
    select * into v_original from public.khata_transactions
     where id = (payload ->> 'reverses_transaction_id')::uuid and account_id = v_account_id;
    if not found then
      raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_original.entry_kind = 'reversal' then
      raise exception 'CANNOT_REVERSE_REVERSAL' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.khata_transactions where reverses_transaction_id = v_original.id) then
      raise exception 'ALREADY_REVERSED' using errcode = 'P0001';
    end if;
    if coalesce(trim(payload ->> 'description'), '') = '' then
      raise exception 'REASON_REQUIRED' using errcode = 'P0001';
    end if;
    v_type := case when v_original.type = 'debit' then 'credit' else 'debit' end::khata_txn_type;
    v_amount := v_original.amount_paise;
    v_order_id := v_original.order_id;
    v_reverses := v_original.id;
  else
    raise exception 'UNKNOWN_ENTRY_KIND' using errcode = 'P0001';
  end if;

  insert into public.khata_transactions (
    account_id, type, amount_paise, description, order_id, occurred_at,
    entry_kind, due_date, payment_method, reverses_transaction_id,
    recorded_by_type, recorded_by_id, idempotency_key
  ) values (
    v_account_id, v_type, v_amount,
    nullif(trim(payload ->> 'description'), ''),
    v_order_id,
    coalesce((payload ->> 'occurred_at')::timestamptz, now()),
    v_kind,
    case when v_kind = 'charge' then (payload ->> 'due_date')::date end,
    case when v_kind = 'payment' then nullif(payload ->> 'payment_method', '') end,
    v_reverses,
    'merchant', (payload ->> 'merchant_id')::uuid, v_key
  )
  returning id into v_id;

  return jsonb_build_object('transaction_id', v_id, 'replayed', false);
end;
$$;

revoke all on function public.record_khata_entry(jsonb) from public, anon, authenticated;
grant execute on function public.record_khata_entry(jsonb) to service_role;

-- Outstanding and overdue amounts are computed from these rows by
-- src/lib/khataAgeing.js (oldest charges settled first), so the merchant app,
-- the customer app and analytics share one implementation.

-- ── create_order: records the payment method, and can charge the khata ──────
-- Same contract as 0030. New: `payment_method` is stored, and a 'khata' order
-- charges the customer's account at this store, under the account's row lock,
-- within its credit limit — in the same transaction as the order, so an order
-- on credit can never exist without the ledger entry that records it.
-- Raises KHATA_UNAVAILABLE or KHATA_LIMIT_EXCEEDED:<available paise>.
create or replace function public.create_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id     uuid := (payload ->> 'customer_id')::uuid;
  v_store_id        uuid := (payload ->> 'store_id')::uuid;
  v_cart_id         uuid := nullif(payload ->> 'cart_id', '')::uuid;
  v_idempotency_key text := nullif(payload ->> 'idempotency_key', '');
  v_status          order_status := (payload ->> 'status')::order_status;
  v_method          text := coalesce(nullif(payload ->> 'payment_method', ''),
                                     case when payload -> 'payment' is not null
                                           and payload -> 'payment' <> 'null'::jsonb then 'online' else 'cash' end);
  v_total           integer := (payload ->> 'total_paise')::integer;
  v_order_id        uuid;
  v_order_number    text;
  v_item            jsonb;
  v_product_id      uuid;
  v_variant_id      uuid;
  v_quantity        integer;
  v_tracked         boolean;
  v_on_hand         integer;
  v_reserved        integer;
  v_account         record;
  v_due_days        integer;
  v_timezone        text;
begin
  if v_idempotency_key is not null then
    select id, order_number into v_order_id, v_order_number
      from public.orders
     where customer_id = v_customer_id
       and idempotency_key = v_idempotency_key;

    if found then
      return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'replayed', true);
    end if;
  end if;

  insert into public.orders (
    store_id, customer_id, fulfilment_mode, status, payment_status, payment_method,
    address_id, delivery_address, store_snapshot,
    subtotal_paise, discount_paise, delivery_fee_paise, tax_paise, total_paise,
    customer_note, idempotency_key
  ) values (
    v_store_id,
    v_customer_id,
    (payload ->> 'fulfilment_mode')::fulfilment_mode,
    v_status,
    (payload ->> 'payment_status')::payment_status,
    v_method,
    nullif(payload ->> 'address_id', '')::uuid,
    payload -> 'delivery_address',
    payload -> 'store_snapshot',
    (payload ->> 'subtotal_paise')::integer,
    (payload ->> 'discount_paise')::integer,
    (payload ->> 'delivery_fee_paise')::integer,
    (payload ->> 'tax_paise')::integer,
    v_total,
    nullif(payload ->> 'customer_note', ''),
    v_idempotency_key
  )
  returning id, order_number into v_order_id, v_order_number;

  for v_item in
    select value from jsonb_array_elements(payload -> 'items') order by value ->> 'variant_id'
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_variant_id := nullif(v_item ->> 'variant_id', '')::uuid;
    v_quantity   := (v_item ->> 'quantity')::integer;

    select p.track_inventory, v.quantity_on_hand, v.reserved_quantity
      into v_tracked, v_on_hand, v_reserved
      from public.product_variants v
      join public.products p on p.id = v.product_id
     where v.id = v_variant_id
       and p.id = v_product_id
       and p.store_id = v_store_id
       and p.is_available
       and p.archived_at is null
       and v.is_available
       for update of v;

    if not found or (v_tracked and v_on_hand - v_reserved < v_quantity) then
      raise exception 'ITEM_UNAVAILABLE:%', coalesce(v_item ->> 'product_name', 'An item')
        using errcode = 'P0001';
    end if;

    insert into public.order_items (
      order_id, product_id, variant_id, product_name, variant_name, sku,
      image_url, unit_price_paise, quantity, tax_percent, tax_paise, line_total_paise
    ) values (
      v_order_id, v_product_id, v_variant_id,
      v_item ->> 'product_name',
      nullif(v_item ->> 'variant_name', ''),
      nullif(v_item ->> 'sku', ''),
      nullif(v_item ->> 'image_url', ''),
      (v_item ->> 'unit_price_paise')::integer,
      v_quantity,
      coalesce((v_item ->> 'tax_percent')::numeric, 0),
      coalesce((v_item ->> 'tax_paise')::integer, 0),
      (v_item ->> 'line_total_paise')::integer
    );

    if v_tracked then
      update public.product_variants
         set reserved_quantity = reserved_quantity + v_quantity
       where id = v_variant_id
       returning quantity_on_hand, reserved_quantity into v_on_hand, v_reserved;

      insert into public.inventory_ledger (
        store_id, product_id, variant_id, movement_type,
        on_hand_change, reserved_change, on_hand_after, reserved_after,
        reference_type, reference_id, performed_by_type, performed_by_id
      ) values (
        v_store_id, v_product_id, v_variant_id, 'order_reserved',
        0, v_quantity, v_on_hand, v_reserved,
        'order', v_order_id, 'customer', v_customer_id
      );
    end if;
  end loop;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (v_order_id, null, v_status, 'customer', payload ->> 'history_note');

  if payload -> 'payment' is not null and payload -> 'payment' <> 'null'::jsonb then
    insert into public.payments (order_id, provider, amount_paise, currency, status)
    values (
      v_order_id,
      payload -> 'payment' ->> 'provider',
      (payload -> 'payment' ->> 'amount_paise')::integer,
      coalesce(payload -> 'payment' ->> 'currency', 'INR'),
      coalesce((payload -> 'payment' ->> 'status')::payment_status, 'pending')
    );
  end if;

  if v_method = 'khata' then
    select s.khata_due_days, s.timezone into v_due_days, v_timezone
      from public.stores s where s.id = v_store_id and s.khata_enabled;
    if not found then
      raise exception 'KHATA_UNAVAILABLE' using errcode = 'P0001';
    end if;

    select * into v_account from public.khata_accounts
     where customer_id = v_customer_id and store_id = v_store_id and is_active
       for update;
    if not found or v_account.credit_limit_paise is null then
      raise exception 'KHATA_UNAVAILABLE' using errcode = 'P0001';
    end if;
    if v_account.balance_paise + v_total > v_account.credit_limit_paise then
      raise exception 'KHATA_LIMIT_EXCEEDED:%', greatest(v_account.credit_limit_paise - v_account.balance_paise, 0)
        using errcode = 'P0001';
    end if;

    if v_total > 0 then
      insert into public.khata_transactions (
        account_id, type, amount_paise, description, order_id, entry_kind, due_date,
        recorded_by_type, recorded_by_id
      ) values (
        v_account.id, 'debit', v_total, 'Order ' || v_order_number, v_order_id, 'charge',
        (now() at time zone v_timezone)::date + v_due_days,
        'customer', v_customer_id
      );

      insert into public.payments (order_id, provider, amount_paise, currency, status, paid_at, raw_payload)
      values (v_order_id, 'khata', v_total, 'INR', 'paid', now(), jsonb_build_object('account_id', v_account.id));

      update public.orders set payment_status = 'paid' where id = v_order_id;
    end if;
  end if;

  if v_cart_id is not null then
    update public.carts set checked_out_at = now() where id = v_cart_id and customer_id = v_customer_id;
    delete from public.cart_items where cart_id = v_cart_id;
  end if;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'replayed', false);
end;
$$;

revoke all on function public.create_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_order(jsonb) to service_role;
