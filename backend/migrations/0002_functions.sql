-- 0002_functions.sql — shared trigger functions.
-- Checklist 1.18. Applied to every mutable table by the migration that creates it.

-- Keeps updated_at honest: the client can never set it, because this overwrites
-- whatever was sent.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Human-friendly, non-sequential order numbers: CPSE-<yymmdd>-<6 random chars>.
-- Random rather than sequential so customers cannot infer order volume, and
-- short enough to read out over the phone.
create or replace function public.generate_order_number()
returns text
language plpgsql
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';  -- no 0/O/1/I
  suffix text := '';
  i integer;
begin
  for i in 1..6 loop
    suffix := suffix || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return 'CPSE-' || to_char(now(), 'YYMMDD') || '-' || suffix;
end;
$$;
