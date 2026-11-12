alter table public.exam_photo_job_item
  add column if not exists finalized_grade_version jsonb;

create or replace function public.finalize_exam_photo_job(p_week_id uuid, p_job_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job public.exam_photo_job;
  row_count integer;
  matched_count integer;
  finalized_count integer;
  versions jsonb;
begin
  select j.* into job from public.exam_photo_job j
  join public.week w on w.id = j.week_id
  join public.class c on c.id = w.class_id and c.teacher_id = j.teacher_id
  join public.teacher t on t.id = j.teacher_id
  where j.id = p_job_id and j.week_id = p_week_id
    and t.auth_id = auth.uid() and t.approval_status = 'approved'
  for update of j;
  if not found then
    raise exception '채점 작업에 접근할 수 없습니다.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception '학생 목록이 필요합니다.' using errcode = '22023';
  end if;
  row_count := jsonb_array_length(p_rows);
  if row_count = 0 or row_count <> (
    select count(distinct r->>'student_id') from jsonb_array_elements(p_rows) r
  ) then
    raise exception '확정할 학생을 확인해 주세요.' using errcode = '22023';
  end if;

  select count(*), count(i.finalized_grade_version),
    jsonb_agg(i.finalized_grade_version order by i.student_id)
    into matched_count, finalized_count, versions
  from jsonb_array_elements(p_rows) r
  join public.exam_photo_job_item i on i.job_id = job.id
    and i.student_id = (r->>'student_id')::uuid
    and i.photo_path = r->>'exam_photo_path'
  where i.grade_draft is not null and (r->>'present')::boolean is true
    and (r->>'reading_present')::boolean is true;

  if matched_count <> row_count then
    raise exception '채점 작업의 답안과 사진을 확인해 주세요.' using errcode = '22023';
  end if;
  if finalized_count = row_count then
    return jsonb_build_object('versions', versions, 'replayed', true);
  end if;
  if job.closed_at is not null or finalized_count > 0 then
    raise exception '이미 확정된 답안이 포함되어 있습니다. 작업을 다시 열어 주세요.' using errcode = '40001';
  end if;

  versions := public.save_week_reading_grades(p_week_id, p_rows);
  if jsonb_array_length(versions) is distinct from row_count then
    raise exception '성적 저장 결과를 확인하지 못했습니다.';
  end if;
  update public.exam_photo_job_item i
    set finalized_grade_version = version
    from jsonb_array_elements(versions) version
    where i.job_id = job.id and i.student_id = (version->>'student_id')::uuid;

  update public.exam_photo_job j set closed_at = now()
    where j.id = job.id and not exists (
      select 1 from public.exam_photo_job_item i
      where i.job_id = job.id and i.finalized_grade_version is null
    );
  return jsonb_build_object('versions', versions, 'replayed', false);
end;
$$;

revoke all on function public.finalize_exam_photo_job(uuid, uuid, jsonb) from public, anon;
grant execute on function public.finalize_exam_photo_job(uuid, uuid, jsonb) to authenticated;
