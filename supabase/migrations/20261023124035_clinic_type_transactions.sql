-- Additional privileges only for the existing restricted app role.
-- Keep existing policies/triggers for all other roles unchanged.
begin;
grant insert, delete on public.concept_tag to edunote_app;
grant insert on public.clinic_enrollment to edunote_app;
alter table public.concept_category enable row level security;
grant select, insert, delete on public.concept_category to edunote_app;
drop policy if exists edunote_app_category_allow on public.concept_category;
create policy edunote_app_category_allow on public.concept_category for all to edunote_app using (true) with check (true);
drop policy if exists edunote_app_category_scope on public.concept_category;
create policy edunote_app_category_scope on public.concept_category as restrictive for all to edunote_app
  using (teacher_id in (select id from public.teacher where auth_id=(select auth.uid()) and approval_status='approved'))
  with check (teacher_id in (select id from public.teacher where auth_id=(select auth.uid()) and approval_status='approved'));
commit;
