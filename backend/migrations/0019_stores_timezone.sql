-- 0019_stores_timezone.sql — the timezone opening hours are expressed in.
-- Needed by the open/closed resolver (checklist 3.2): '09:00' in a store's
-- opening_hours is local wall-clock time, and the server may be anywhere.
--
-- Added as its own migration rather than edited into 0004, because 0004 may
-- already have been applied in the Supabase SQL editor.

alter table public.stores
  add column if not exists timezone text not null default 'Asia/Kolkata';

-- Rejects a typo like 'Asia/Kolkatta' at write time: casting to timestamptz
-- with an unknown zone raises, and the store page would otherwise fall back to
-- the server's zone and report the wrong open/closed state.
do $$ begin
  alter table public.stores
    add constraint stores_timezone_valid check (now() at time zone timezone is not null);
exception when duplicate_object then null; end $$;

comment on column public.stores.timezone is
  'IANA zone name. opening_hours are local wall-clock times in this zone.';
