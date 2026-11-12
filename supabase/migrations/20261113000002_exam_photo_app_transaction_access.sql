grant select on public.exam_photo_job, public.exam_photo_job_item to edunote_app;
grant update (closed_at) on public.exam_photo_job to edunote_app;
grant update (finalized_grade_version) on public.exam_photo_job_item to edunote_app;

drop policy if exists edunote_app_exam_photo_job on public.exam_photo_job;
create policy edunote_app_exam_photo_job on public.exam_photo_job to edunote_app
  using (
    exists (select 1 from public.week w join public.class c on c.id = w.class_id
      join public.teacher t on t.id = c.teacher_id
      where w.id = exam_photo_job.week_id and t.id = exam_photo_job.teacher_id
        and t.auth_id = auth.uid() and t.approval_status = 'approved')
  );

drop policy if exists edunote_app_exam_photo_job_item on public.exam_photo_job_item;
create policy edunote_app_exam_photo_job_item on public.exam_photo_job_item to edunote_app
  using (
    exists (select 1 from public.exam_photo_job j
      join public.week w on w.id = j.week_id
      join public.class c on c.id = w.class_id and c.teacher_id = j.teacher_id
      join public.teacher t on t.id = j.teacher_id
      where j.id = exam_photo_job_item.job_id
        and t.auth_id = auth.uid() and t.approval_status = 'approved')
  );
