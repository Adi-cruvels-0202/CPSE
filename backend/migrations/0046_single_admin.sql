-- 0046 — one kind of platform admin.
--
-- 0045 gave admins roles (superadmin, reviewer, support). The platform is run
-- by one admin who does everything, so the roles are dropped: an admin is
-- simply an account with a platform_admins row, made by the operator
-- (`npm run admin -- grant <email>`). Idempotent.

alter table public.platform_admins drop constraint if exists platform_admins_role_check;
alter table public.platform_admins drop column if exists role;
alter table public.platform_admins drop column if exists created_by;
