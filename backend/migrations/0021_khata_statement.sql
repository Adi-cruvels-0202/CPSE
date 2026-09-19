-- 0021_khata_statement.sql — statement aggregates for the khata view.
-- Checklist 9.7 and 9.8.
--
-- A statement needs three numbers the ledger does not store: the balance as it
-- stood before the period opened, and the debit and credit totals inside it.
-- Summing those in the API would mean reading every transaction ever recorded
-- into Node just to add them up, and the answer would drift from
-- khata_accounts.balance_paise the moment the two implementations disagreed.
-- Postgres already maintains that balance from this same ledger (0017), so the
-- arithmetic belongs here too.
--
-- Read-only: it selects and aggregates, and writes nothing. Customer khata
-- stays read-only (checklist 9.9) — this function does not change that.
--
-- `security definer` so it can read the ledger regardless of the caller's RLS
-- view — which is exactly why it is granted to service_role alone (see the
-- grants at the bottom). Ownership of the account is checked in the API, in
-- `findOwnedAccount`, before this is ever called; the function is handed an
-- account id and does not know whose it is.

create or replace function public.khata_statement(
  p_account_id uuid,
  p_from       timestamptz default null,
  p_to         timestamptz default null
)
returns table (
  opening_paise integer,
  debit_paise   integer,
  credit_paise  integer,
  closing_paise integer,
  txn_count     integer
)
language sql
stable
security definer
set search_path = public
as $$
  with before_period as (
    select
      coalesce(sum(case when type = 'debit'  then amount_paise else 0 end), 0)
      - coalesce(sum(case when type = 'credit' then amount_paise else 0 end), 0) as balance
    from public.khata_transactions
    where account_id = p_account_id
      -- With no lower bound the period starts at the beginning of the ledger,
      -- so nothing precedes it and the opening balance is 0. `p_from is null or
      -- ...` would instead match every row and count the whole ledger twice.
      and p_from is not null
      and occurred_at < p_from
  ),
  in_period as (
    select
      coalesce(sum(case when type = 'debit'  then amount_paise else 0 end), 0) as debits,
      coalesce(sum(case when type = 'credit' then amount_paise else 0 end), 0) as credits,
      count(*)                                                                 as entries
    from public.khata_transactions
    where account_id = p_account_id
      and (p_from is null or occurred_at >= p_from)
      and (p_to   is null or occurred_at <= p_to)
  )
  select
    before_period.balance::integer                                            as opening_paise,
    in_period.debits::integer                                                 as debit_paise,
    in_period.credits::integer                                                as credit_paise,
    (before_period.balance + in_period.debits - in_period.credits)::integer   as closing_paise,
    in_period.entries::integer                                                as txn_count
  from before_period, in_period;
$$;

-- service_role ONLY, deliberately.
--
-- This function takes an account id, not a customer, and being `security
-- definer` it does not see RLS. Granting it to `authenticated` would let any
-- signed-in customer call it through PostgREST for an arbitrary account id and
-- read that account's totals, straight past the ownership check the API does in
-- `findOwnedAccount` before it calls this. The API is the only caller and it
-- connects as the service role, so the grant an earlier draft of this migration
-- gave `authenticated` bought nothing and cost that.
-- Supabase sets default privileges that grant EXECUTE on every new function in
-- this schema to `anon` and `authenticated`. Revoking from the PUBLIC
-- pseudo-role does NOT remove those, so both roles are named explicitly — the
-- same form 0020 uses for create_order.
revoke all on function public.khata_statement(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.khata_statement(uuid, timestamptz, timestamptz)
  to service_role;
