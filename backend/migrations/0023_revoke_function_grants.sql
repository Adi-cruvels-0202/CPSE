-- 0023_revoke_function_grants.sql — closes a privilege hole left by 0021 and 0022.
--
-- WHY THIS EXISTS AS ITS OWN MIGRATION
--
-- 0021 and 0022 created three functions and revoked them `from public`, which
-- reads like it removes everyone's access. It does not. Supabase configures
-- default privileges on this schema that grant EXECUTE on every newly created
-- function to `anon` and `authenticated`, and revoking from the PUBLIC
-- pseudo-role leaves a role-specific grant untouched. 0020 had it right —
-- `from public, anon, authenticated` — and 0021/0022 did not follow it.
--
-- The effect on a database that applied those two as first written:
--
--   khata_statement            any holder of the anon key — which is a public
--                              key, designed to ship inside frontend code —
--                              could read any khata account's opening, debit,
--                              credit and closing totals given its id.
--   expire_stale_pending_orders  worse: called with a short interval it cancels
--                              every order sitting in pending_payment and
--                              returns their stock. Unauthenticated.
--   purge_abandoned_carts      worse still: called with a short interval it
--                              deletes every open cart in the system, with
--                              their items, for every customer.
--
-- 0021 and 0022 have been corrected in place for a fresh deployment. This file
-- is what fixes a database where the earlier version was already run. It is
-- idempotent, and safe to run even if the corrected versions were applied.

revoke all on function public.khata_statement(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.expire_stale_pending_orders(interval)
  from public, anon, authenticated;
revoke all on function public.purge_abandoned_carts(interval)
  from public, anon, authenticated;

-- Re-stated so this file alone leaves the three functions in their intended
-- state: reachable by the API's service-role connection, and by nothing else.
grant execute on function public.khata_statement(uuid, timestamptz, timestamptz)
  to service_role;
grant execute on function public.expire_stale_pending_orders(interval) to service_role;
grant execute on function public.purge_abandoned_carts(interval)      to service_role;

-- And create_order, which was already correct, re-stated for the same reason.
revoke all on function public.create_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_order(jsonb) to service_role;

-- generate_order_number (0002) was also left callable by anon. The impact is
-- nil — it is a pure random-string generator with no data access, no side
-- effects and no definer rights — but the rule is applied uniformly rather than
-- judged per function, because "this one is harmless" is how the next one slips
-- through.
--
-- Safe to revoke despite being a column default on orders.order_number: the
-- only writers of that table are create_order, which is `security definer` and
-- so evaluates the default as its owner, and the API's service-role connection.
-- RLS grants `authenticated` select on orders and no insert policy at all, so no
-- customer-role insert ever evaluates it.
revoke all on function public.generate_order_number() from public, anon, authenticated;
grant execute on function public.generate_order_number() to service_role;
