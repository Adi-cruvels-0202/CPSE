-- 0045 — the platform admin portal.
--
-- * Admin roles. Every platform admin has exactly one:
--     superadmin  everything, including suspending accounts and managing admins
--     reviewer    store verification and store moderation
--     support     escalated customer support
--   Existing admins (created before roles existed) become superadmins, so
--   nothing they could do before is taken away.
-- * Account suspension. Every account — customer or shop owner — has a
--   customers row (trigger in 0003), so suspension lives there: a suspended
--   account cannot sign in and its existing sessions are refused.
-- * "Publish when approved". A shop owner who presses Publish before the
--   store is verified records the wish; approval then publishes the store.
-- * An append-only log of every admin action, with who, what and why.
--
-- Idempotent, like every migration here.

-- ── Roles ───────────────────────────────────────────────────────────────────

alter table public.platform_admins
  add column if not exists role text not null default 'superadmin',
  add column if not exists created_by uuid;

do $$ begin
  alter table public.platform_admins
    add constraint platform_admins_role_check check (role in ('superadmin', 'reviewer', 'support'));
exception when duplicate_object then null; end $$;

-- ── Account suspension ──────────────────────────────────────────────────────

alter table public.customers
  add column if not exists suspended_at     timestamptz,
  add column if not exists suspended_reason text,
  add column if not exists suspended_by     uuid;

do $$ begin
  alter table public.customers
    add constraint customers_suspension_reason check (
      (suspended_at is null and suspended_reason is null)
      or (suspended_at is not null and suspended_reason is not null and char_length(suspended_reason) between 3 and 500)
    );
exception when duplicate_object then null; end $$;

create index if not exists customers_suspended_idx on public.customers (suspended_at) where suspended_at is not null;

-- ── Publish when approved ───────────────────────────────────────────────────

alter table public.stores
  add column if not exists publish_requested_at timestamptz;

-- ── Admin action log ────────────────────────────────────────────────────────
-- No foreign keys on purpose: the log must outlive the admins, stores and
-- accounts it mentions, and never block their removal.

create table if not exists public.admin_actions (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid,
  admin_email  text not null,
  action       text not null,
  target_type  text not null,
  target_id    uuid,
  target_label text,
  reason       text,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),

  constraint admin_actions_action check (action in (
    'store_approved', 'store_rejected', 'store_verification_revoked', 'store_unpublished',
    'account_suspended', 'account_reinstated',
    'admin_added', 'admin_role_changed', 'admin_removed'
  )),
  constraint admin_actions_target_type check (target_type in ('store', 'account', 'admin')),
  constraint admin_actions_reason_len check (reason is null or char_length(reason) <= 500)
);

create index if not exists admin_actions_created_idx on public.admin_actions (created_at desc);
create index if not exists admin_actions_target_idx on public.admin_actions (target_type, target_id, created_at desc);

alter table public.admin_actions enable row level security;  -- service role only; no policies

create or replace function public.reject_admin_action_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin_actions rows are immutable';
end;
$$;

drop trigger if exists admin_actions_immutable on public.admin_actions;
create trigger admin_actions_immutable
  before update or delete on public.admin_actions
  for each row execute function public.reject_admin_action_change();

-- ── Accounts list for the portal ────────────────────────────────────────────
-- One query for "customers" (accounts that are not shop owners), "merchants"
-- or both, searchable and paged, with the counts the list shows.

create or replace function public.admin_list_accounts(payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind   text := coalesce(payload ->> 'kind', 'all');
  v_status text := coalesce(payload ->> 'status', 'all');
  v_search text := nullif(trim(payload ->> 'search'), '');
  v_limit  int  := least(greatest(coalesce((payload ->> 'limit')::int, 20), 1), 100);
  v_offset int  := greatest(coalesce((payload ->> 'offset')::int, 0), 0);
  v_rows   jsonb;
  v_total  int;
begin
  with base as (
    select c.id, c.email, c.full_name, c.phone, c.created_at, c.suspended_at, c.suspended_reason,
           (m.id is not null) as is_merchant,
           (a.id is not null) as is_admin
      from public.customers c
      left join public.merchants m on m.id = c.id
      left join public.platform_admins a on a.id = c.id
     where (v_kind = 'all'
            or (v_kind = 'merchant' and m.id is not null)
            or (v_kind = 'customer' and m.id is null and a.id is null))
       and (v_status = 'all'
            or (v_status = 'suspended' and c.suspended_at is not null)
            or (v_status = 'active' and c.suspended_at is null))
       and (v_search is null
            or c.email::text ilike '%' || v_search || '%'
            or coalesce(c.full_name, '') ilike '%' || v_search || '%'
            or coalesce(c.phone, '') ilike '%' || v_search || '%')
  )
  select count(*)::int into v_total from base;

  with base as (
    select c.id, c.email, c.full_name, c.phone, c.created_at, c.suspended_at, c.suspended_reason,
           (m.id is not null) as is_merchant,
           (a.id is not null) as is_admin
      from public.customers c
      left join public.merchants m on m.id = c.id
      left join public.platform_admins a on a.id = c.id
     where (v_kind = 'all'
            or (v_kind = 'merchant' and m.id is not null)
            or (v_kind = 'customer' and m.id is null and a.id is null))
       and (v_status = 'all'
            or (v_status = 'suspended' and c.suspended_at is not null)
            or (v_status = 'active' and c.suspended_at is null))
       and (v_search is null
            or c.email::text ilike '%' || v_search || '%'
            or coalesce(c.full_name, '') ilike '%' || v_search || '%'
            or coalesce(c.phone, '') ilike '%' || v_search || '%')
     order by c.created_at desc
     limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'email', b.email, 'full_name', b.full_name, 'phone', b.phone,
           'created_at', b.created_at, 'suspended_at', b.suspended_at, 'suspended_reason', b.suspended_reason,
           'is_merchant', b.is_merchant, 'is_admin', b.is_admin,
           'store_count', (select count(*) from public.stores s where s.owner_id = b.id),
           'order_count', (select count(*) from public.orders o where o.customer_id = b.id)
         ) order by b.created_at desc), '[]'::jsonb)
    into v_rows
    from base b;

  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;

revoke all on function public.admin_list_accounts(jsonb) from public, anon, authenticated;
grant execute on function public.admin_list_accounts(jsonb) to service_role;
