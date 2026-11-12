alter table public.exam_photo_job_item
  add column if not exists grade_draft jsonb,
  add column if not exists grade_draft_revision integer not null default 0;

create or replace function public.save_initial_exam_photo_grades(
  p_job_id uuid, p_week_id uuid, p_teacher_id uuid, p_rows jsonb
) returns void language plpgsql set search_path = '' as $$
declare
  saved_count integer;
begin
  update public.exam_photo_job_item item
  set grade_draft = draft.row, grade_draft_revision = 1
  from jsonb_array_elements(p_rows) as draft(row), public.exam_photo_job job
  where job.id = p_job_id and job.week_id = p_week_id and job.teacher_id = p_teacher_id
    and job.closed_at is null and item.job_id = job.id
    and item.student_id = (draft.row->>'student_id')::uuid
    and item.photo_path = draft.row->>'exam_photo_path'
    and item.ocr_results is not null and item.grade_draft is null;
  get diagnostics saved_count = row_count;
  if saved_count <> jsonb_array_length(p_rows) then
    raise exception 'Photo grade draft changed' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.save_initial_exam_photo_grades(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_initial_exam_photo_grades(uuid, uuid, uuid, jsonb) to service_role;
