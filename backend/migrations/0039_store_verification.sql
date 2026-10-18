-- 0039_store_verification.sql — a store is verified before it is published.
--
-- Roadmap §4 P1 "Merchant Store Verification / KYC" and the critical addition
-- "Merchant onboarding verification".
--
--   not_submitted ──merchant submits──▶ pending ──reviewer──▶ verified
--          ▲                               │                    │
--          └──────── merchant resubmits ◀── rejected ◀──────────┘ (revoked)
--
-- * A store can only be PUBLISHED once verified — enforced here by trigger,
--   behind the API's own check. Revoking a verification unpublishes the store.
-- * Supporting documents (GST certificate, shop photo, identity, business and
--   address proof) live in a PRIVATE storage bucket. Their paths never appear
--   in a public API; a reviewer or the owner reads one through a short-lived
--   signed URL. No identity number is stored as text — only the documents the
--   merchant chose to upload, which should be masked where the law allows.
-- * Every status change is an append-only verification_events row with who
--   decided, why, and a snapshot of what was submitted.
-- * Reviewers are platform admins: auth users with a platform_admins row.
--   Nothing creates one but an operator.

create table if not exists public.platform_admins (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      citext not null,
  full_name  text,
  created_at timestamptz not null default now(),

  constraint platform_admins_full_name_len check (full_name is null or char_length(full_name) between 1 and 120)
);

alter table public.platform_admins enable row level security;

drop policy if exists platform_admins_select_own on public.platform_admins;
create policy platform_admins_select_own on public.platform_admins
  for select to authenticated using (id = (select auth.uid()));

do $$ begin
  create type verification_status as enum ('not_submitted', 'pending', 'verified', 'rejected');
exception when duplicate_object then null; end $$;

-- Denormalised onto the store so the publish check and the store list need no
-- join. Written only by set_verification_status below.
alter table public.stores
  add column if not exists verification_status verification_status not null default 'not_submitted';

create table if not exists public.store_verifications (
  store_id          uuid primary key references public.stores (id) on delete cascade,
  legal_name        text,
  business_type     text,
  gst_applicable    boolean not null default false,
  gstin             text,
  owner_name        text,
  owner_phone       text,
  owner_email       citext,
  -- { line1, line2, city, state, postalCode } — the registered business
  -- address, when it differs from the shop's.
  business_address  jsonb,
  submitted_at      timestamptz,
  reviewed_at       timestamptz,
  reviewed_by       uuid references public.platform_admins (id) on delete set null,
  rejection_reason  text,
  review_note       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint store_verifications_legal_name_len check (legal_name is null or char_length(legal_name) between 2 and 200),
  constraint store_verifications_business_type check (business_type is null or business_type in (
    'individual', 'proprietorship', 'partnership', 'llp', 'private_limited', 'public_limited', 'other'
  )),
  -- The GSTIN's published shape: state code, PAN, entity number, Z, checksum.
  constraint store_verifications_gstin_format check (
    gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
  ),
  constraint store_verifications_owner_name_len check (owner_name is null or char_length(owner_name) between 2 and 120),
  constraint store_verifications_owner_phone check (owner_phone is null or owner_phone ~ '^\+?[0-9]{7,15}$'),
  constraint store_verifications_rejection_len check (rejection_reason is null or char_length(rejection_reason) between 3 and 500),
  constraint store_verifications_note_len check (review_note is null or char_length(review_note) <= 500)
);

create index if not exists store_verifications_reviewed_by_idx on public.store_verifications (reviewed_by);

drop trigger if exists store_verifications_set_updated_at on public.store_verifications;
create trigger store_verifications_set_updated_at
  before update on public.store_verifications
  for each row execute function public.set_updated_at();

create table if not exists public.verification_documents (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores (id) on delete cascade,
  doc_type      text not null,
  -- Inside the private 'kyc' bucket; never a public URL.
  storage_path  text not null,
  mime_type     text not null,
  size_bytes    integer not null,
  sha256        text not null,
  uploaded_by   uuid references public.merchants (id) on delete set null,
  -- A replaced document stays for the audit trail but is no longer current.
  is_current    boolean not null default true,
  created_at    timestamptz not null default now(),

  constraint verification_documents_doc_type check (doc_type in (
    'gst_certificate', 'shop_photo', 'identity_proof', 'business_proof', 'address_proof', 'other'
  )),
  constraint verification_documents_mime check (mime_type in ('image/webp', 'application/pdf')),
  constraint verification_documents_size check (size_bytes between 1 and 5242880),
  constraint verification_documents_sha256 check (sha256 ~ '^[0-9a-f]{64}$')
);

create unique index if not exists verification_documents_path_key on public.verification_documents (storage_path);
create index if not exists verification_documents_store_id_idx on public.verification_documents (store_id, doc_type);
create index if not exists verification_documents_uploaded_by_idx on public.verification_documents (uploaded_by);

create table if not exists public.verification_events (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id) on delete cascade,
  from_status verification_status,
  to_status   verification_status not null,
  actor_type  text not null,
  actor_id    uuid,
  reason      text,
  -- What was in front of the reviewer: the details and the document ids.
  snapshot    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),

  constraint verification_events_actor check (actor_type in ('merchant', 'admin', 'system')),
  constraint verification_events_reason_len check (reason is null or char_length(reason) <= 500)
);

create index if not exists verification_events_store_id_idx on public.verification_events (store_id, created_at);

create or replace function public.reject_verification_event_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_setting('cpse.deleting_store', true) = 'on' then
    return old;
  end if;
  raise exception 'verification_events rows are immutable';
end;
$$;

drop trigger if exists verification_events_immutable on public.verification_events;
create trigger verification_events_immutable
  before update or delete on public.verification_events
  for each row execute function public.reject_verification_event_change();

alter table public.store_verifications enable row level security;
alter table public.verification_documents enable row level security;
alter table public.verification_events enable row level security;

drop policy if exists store_verifications_select_owner on public.store_verifications;
create policy store_verifications_select_owner on public.store_verifications
  for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));

drop policy if exists verification_documents_select_owner on public.verification_documents;
create policy verification_documents_select_owner on public.verification_documents
  for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));

drop policy if exists verification_events_select_owner on public.verification_events;
create policy verification_events_select_owner on public.verification_events
  for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));

-- ── The only writer of a store's verification status ────────────────────────
-- payload: { store_id, to_status, actor_type, actor_id, reason, review_note }
-- Raises ILLEGAL_TRANSITION:<from>:<to>, REASON_REQUIRED, STORE_NOT_FOUND.
create or replace function public.set_verification_status(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid := (payload ->> 'store_id')::uuid;
  v_to       verification_status := (payload ->> 'to_status')::verification_status;
  v_actor    text := payload ->> 'actor_type';
  v_from     verification_status;
  v_reason   text := nullif(trim(payload ->> 'reason'), '');
  v_snapshot jsonb;
  v_legal    boolean;
begin
  select verification_status into v_from from public.stores where id = v_store_id for update;
  if not found then
    raise exception 'STORE_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_legal := case
    when v_actor = 'merchant' then v_to = 'pending' and v_from in ('not_submitted', 'rejected')
    when v_actor = 'admin' then (v_from = 'pending' and v_to in ('verified', 'rejected'))
                                 or (v_from = 'verified' and v_to = 'rejected')
    else false
  end;
  if not v_legal then
    raise exception 'ILLEGAL_TRANSITION:%:%', v_from, v_to using errcode = 'P0001';
  end if;
  if v_to = 'rejected' and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.store_verifications (store_id) values (v_store_id) on conflict (store_id) do nothing;

  select jsonb_build_object(
           'details', to_jsonb(sv) - 'created_at' - 'updated_at',
           'documents', coalesce((
             select jsonb_agg(jsonb_build_object('id', d.id, 'docType', d.doc_type, 'sha256', d.sha256) order by d.created_at)
               from public.verification_documents d
              where d.store_id = v_store_id and d.is_current
           ), '[]'::jsonb)
         )
    into v_snapshot
    from public.store_verifications sv where sv.store_id = v_store_id;

  update public.stores
     set verification_status = v_to,
         -- A revoked or rejected store stops being visible to customers.
         is_published = case when v_to = 'rejected' then false else is_published end
   where id = v_store_id;

  update public.store_verifications
     set submitted_at     = case when v_to = 'pending' then now() else submitted_at end,
         reviewed_at      = case when v_actor = 'admin' then now() else reviewed_at end,
         reviewed_by      = case when v_actor = 'admin' then (payload ->> 'actor_id')::uuid else reviewed_by end,
         rejection_reason = case when v_to = 'rejected' then v_reason when v_to = 'verified' then null else rejection_reason end,
         review_note      = case when v_actor = 'admin' then nullif(trim(payload ->> 'review_note'), '') else review_note end
   where store_id = v_store_id;

  insert into public.verification_events (store_id, from_status, to_status, actor_type, actor_id, reason, snapshot)
  values (v_store_id, v_from, v_to, v_actor, (payload ->> 'actor_id')::uuid, v_reason,
          case when v_to = 'pending' or v_actor = 'admin' then v_snapshot else '{}'::jsonb end);

  return jsonb_build_object('store_id', v_store_id, 'from_status', v_from, 'to_status', v_to);
end;
$$;

revoke all on function public.set_verification_status(jsonb) from public, anon, authenticated;
grant execute on function public.set_verification_status(jsonb) to service_role;

-- ── Publishing needs a verified store ───────────────────────────────────────
-- Applies to the moment of publishing, so stores published before verification
-- existed stay visible until a reviewer looks at them.
create or replace function public.require_verified_to_publish()
returns trigger
language plpgsql
as $$
begin
  if new.is_published and not coalesce(old.is_published, false) and new.verification_status <> 'verified' then
    raise exception 'STORE_NOT_VERIFIED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists stores_require_verified_to_publish on public.stores;
create trigger stores_require_verified_to_publish
  before update of is_published on public.stores
  for each row execute function public.require_verified_to_publish();

-- ── Private storage for verification documents ──────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('kyc', 'kyc', false, 5242880, array['image/webp', 'application/pdf'])
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
