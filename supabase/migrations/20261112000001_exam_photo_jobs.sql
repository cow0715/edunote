create table if not exists public.exam_photo_job (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.week(id) on delete cascade,
  teacher_id uuid not null references public.teacher(id) on delete cascade,
  closed_at timestamptz
);

create unique index if not exists exam_photo_job_open_week
  on public.exam_photo_job (week_id) where closed_at is null;

create table if not exists public.exam_photo_job_item (
  job_id uuid not null references public.exam_photo_job(id) on delete cascade,
  student_id uuid not null references public.student(id) on delete cascade,
  photo_path text,
  mime_type text,
  ocr_results jsonb,
  ocr_lease_until timestamptz,
  primary key (job_id, student_id)
);

alter table public.exam_photo_job enable row level security;
alter table public.exam_photo_job_item enable row level security;
revoke all on public.exam_photo_job, public.exam_photo_job_item from public, anon, authenticated;
grant select, insert, update on public.exam_photo_job, public.exam_photo_job_item to service_role;

create or replace function public.start_exam_photo_job(p_week_id uuid, p_teacher_id uuid, p_students uuid[])
returns uuid language plpgsql set search_path = '' as $$
declare
  new_job uuid;
begin
  if coalesce(cardinality(p_students), 0) = 0 or not exists (
    select 1 from public.week w join public.class c on c.id = w.class_id
    where w.id = p_week_id and c.teacher_id = p_teacher_id
    and not exists (
      select 1 from unnest(p_students) s(id)
      where not exists (
        select 1 from public.class_student cs where cs.class_id = c.id and cs.student_id = s.id
      )
    )
  ) then
    raise exception 'Invalid students for exam photo job' using errcode = '22023';
  end if;

  insert into public.exam_photo_job (week_id, teacher_id)
  values (p_week_id, p_teacher_id) returning id into new_job;
  insert into public.exam_photo_job_item (job_id, student_id)
  select new_job, s.id from unnest(p_students) s(id);
  return new_job;
end;
$$;

revoke all on function public.start_exam_photo_job(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.start_exam_photo_job(uuid, uuid, uuid[]) to service_role;
