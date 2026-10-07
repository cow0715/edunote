-- Apply manually to development and production before deploying transaction routes.
-- Set a UNIQUE password and LOGIN separately; never commit the password.
-- No grants to authenticated/anon, and no changes to their existing policies.
begin;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'edunote_app') then
    create role edunote_app nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if exists (select 1 from pg_roles where rolname = 'edunote_app' and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication))
     or exists (select 1 from pg_auth_members where member = 'edunote_app'::regrole)
     or exists (select 1 from pg_class where relowner = 'edunote_app'::regrole) then
    raise exception 'edunote_app must be a dedicated unprivileged non-owner role';
  end if;
end $$;

grant connect on database postgres to edunote_app;
grant usage on schema public, auth, extensions to edunote_app;
grant execute on function auth.uid() to edunote_app;
-- Both environments may have different existing RLS policies. These restrictive
-- policies apply only to this driver role and cannot be widened by allow-all.
alter table public.teacher enable row level security;
alter table public.class enable row level security;
alter table public.class_period enable row level security;
alter table public.week enable row level security;

revoke all on public.teacher, public.class, public.class_period, public.week from edunote_app;
grant select on public.teacher to edunote_app;
grant select, insert, update on public.class, public.week to edunote_app;
grant select, insert, update, delete on public.class_period to edunote_app;

drop policy if exists edunote_app_teacher_allow on public.teacher;
create policy edunote_app_teacher_allow on public.teacher for select to edunote_app using (auth_id = (select auth.uid()));
drop policy if exists edunote_app_teacher_scope on public.teacher;
create policy edunote_app_teacher_scope on public.teacher as restrictive for all to edunote_app
  using (auth_id = (select auth.uid())) with check (false);

drop policy if exists edunote_app_class_allow on public.class;
create policy edunote_app_class_allow on public.class for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_class_scope on public.class;
create policy edunote_app_class_scope on public.class as restrictive for all to edunote_app
  using (teacher_id in (select id from public.teacher where auth_id = (select auth.uid()) and approval_status = 'approved'))
  with check (teacher_id in (select id from public.teacher where auth_id = (select auth.uid()) and approval_status = 'approved'));

drop policy if exists edunote_app_week_allow on public.week;
create policy edunote_app_week_allow on public.week for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_week_scope on public.week;
create policy edunote_app_week_scope on public.week as restrictive for all to edunote_app
  using (class_id in (select id from public.class)) with check (class_id in (select id from public.class));

drop policy if exists edunote_app_period_allow on public.class_period;
create policy edunote_app_period_allow on public.class_period for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_period_scope on public.class_period;
create policy edunote_app_period_scope on public.class_period as restrictive for all to edunote_app
  using (class_id in (select id from public.class)) with check (class_id in (select id from public.class));

-- Catch inherited PUBLIC privileges that table REVOKEs alone cannot remove.
do $$ declare t text; begin
  foreach t in array array['teacher','class','class_period','week'] loop
    if has_table_privilege('edunote_app', 'public.' || t, 'TRUNCATE')
       or has_table_privilege('edunote_app', 'public.' || t, 'TRIGGER') then
      raise exception 'Unexpected PUBLIC privileges for edunote_app on %; review before deployment', t;
    end if;
  end loop;
  if has_schema_privilege('edunote_app', 'public', 'CREATE') then
    raise exception 'PUBLIC schema CREATE must be restricted before deployment';
  end if;
end $$;
commit;
