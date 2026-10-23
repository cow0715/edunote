-- Apply to development and production before deploying report-dispatch transactions.
-- Preserve existing policies/triggers and grants for authenticated/anon.
begin;
alter table public.report_card enable row level security;
grant select, insert, update on public.report_card to edunote_app;
drop policy if exists edunote_app_report_card_allow on public.report_card;
create policy edunote_app_report_card_allow on public.report_card for all to edunote_app
  using (true) with check (true);
drop policy if exists edunote_app_report_card_scope on public.report_card;
create policy edunote_app_report_card_scope on public.report_card as restrictive for all to edunote_app
  using (
    teacher_id in (select id from public.teacher where auth_id=(select auth.uid()) and approval_status='approved')
    and student_id in (select id from public.student)
    and (class_id is null or class_id in (select id from public.class))
  )
  with check (
    teacher_id in (select id from public.teacher where auth_id=(select auth.uid()) and approval_status='approved')
    and student_id in (select id from public.student)
    and (class_id is null or class_id in (select id from public.class))
  );
commit;
