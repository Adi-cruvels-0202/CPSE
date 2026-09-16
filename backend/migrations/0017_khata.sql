-- 0017_khata.sql — store credit ledger. Checklist 1.15.
-- READ-ONLY for the customer: the portal shows the balance and the statement,
-- and never writes to it. Merchant-side khata administration is out of scope,
-- so rows arrive as seed data. RLS in 0018 grants select only.

create table if not exists public.khata_accounts (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers (id) on delete cascade,
  store_id      uuid not null references public.stores (id) on delete cascade,
  -- Positive = the customer owes the store. Maintained by the trigger below so
  -- the balance can never drift from the transactions that justify it.
  balance_paise integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint khata_accounts_unique_per_store unique (customer_id, store_id)
);

create index if not exists khata_accounts_customer_id_idx on public.khata_accounts (customer_id);
create index if not exists khata_accounts_store_id_idx    on public.khata_accounts (store_id);

drop trigger if exists khata_accounts_set_updated_at on public.khata_accounts;
create trigger khata_accounts_set_updated_at
  before update on public.khata_accounts
  for each row execute function public.set_updated_at();

create table if not exists public.khata_transactions (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.khata_accounts (id) on delete cascade,
  type          khata_txn_type not null,   -- debit = owes more, credit = repaid
  amount_paise  integer not null,
  description   text,
  -- Set when the entry came from an order placed in the portal.
  order_id      uuid references public.orders (id) on delete set null,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),

  constraint khata_transactions_amount_positive check (amount_paise > 0)
);

create index if not exists khata_transactions_account_id_idx
  on public.khata_transactions (account_id, occurred_at desc);
create index if not exists khata_transactions_order_id_idx
  on public.khata_transactions (order_id);

-- Keeps khata_accounts.balance_paise in step with its ledger. Writing the
-- balance by hand from application code would eventually drift; this cannot.
create or replace function public.apply_khata_transaction()
returns trigger
language plpgsql
as $$
declare
  delta integer;
begin
  if tg_op = 'INSERT' then
    delta := case when new.type = 'debit' then new.amount_paise else -new.amount_paise end;
    update public.khata_accounts
       set balance_paise = balance_paise + delta
     where id = new.account_id;
    return new;
  elsif tg_op = 'DELETE' then
    delta := case when old.type = 'debit' then -old.amount_paise else old.amount_paise end;
    update public.khata_accounts
       set balance_paise = balance_paise + delta
     where id = old.account_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists khata_transactions_apply on public.khata_transactions;
create trigger khata_transactions_apply
  after insert or delete on public.khata_transactions
  for each row execute function public.apply_khata_transaction();

-- The ledger is an audit trail; amending an entry would break the balance the
-- trigger above maintains. Corrections are made with a compensating entry.
create or replace function public.reject_khata_transaction_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'khata_transactions rows are immutable; insert a compensating entry instead';
end;
$$;

drop trigger if exists khata_transactions_immutable on public.khata_transactions;
create trigger khata_transactions_immutable
  before update on public.khata_transactions
  for each row execute function public.reject_khata_transaction_update();
