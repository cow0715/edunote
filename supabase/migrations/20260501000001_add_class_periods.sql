-- Class metadata and in-class learning periods.
-- A class represents one school/grade/academic-year course, while class_period
-- represents exam-prep windows such as "1학기 중간" and "1학기 기말".

alter table class
  add column if not exists academic_year int,
  add column if not exists school_name text,
  add column if not exists grade_level int,
  add column if not exists archived_at timestamptz;

update class
set academic_year = extract(year from start_date)::int
where academic_year is null
  and start_date is not null;

update class
set grade_level = nullif(substring(name from '([0-9]+)\s*반$'), '')::int
where grade_level is null
  and substring(name from '([0-9]+)\s*반$') is not null;

update class
set school_name = nullif(trim(regexp_replace(name, '\s*[0-9]+반$', '')), '')
where school_name is null;

create table if not exists class_period (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references class(id) on delete cascade,
  label text not null,
  semester int not null check (semester in (1, 2)),
  exam_type text not null default 'other' check (exam_type in ('midterm', 'final', 'other')),
  start_date date not null,
  end_date date,
  is_current boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create unique index if not exists idx_class_period_one_current
  on class_period(class_id)
  where is_current;

create index if not exists idx_class_period_class_sort
  on class_period(class_id, sort_order, start_date);

insert into class_period (class_id, label, semester, exam_type, start_date, end_date, is_current, sort_order)
select
  c.id,
  '기존',
  1,
  'other',
  coalesce(c.start_date, current_date),
  null,
  true,
  1
from class c
where not exists (
  select 1
  from class_period cp
  where cp.class_id = c.id
);

alter table class_period enable row level security;

drop policy if exists "class_period_owner" on class_period;
create policy "class_period_owner" on class_period
  for all using (
    class_id in (
      select c.id
      from class c
      where c.teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  )
  with check (
    class_id in (
      select c.id
      from class c
      where c.teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  );

create or replace function update_class_period_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_class_period_updated_at on class_period;
create trigger trg_class_period_updated_at
  before update on class_period
  for each row execute function update_class_period_updated_at();

create or replace function restore_truncate_tables()
returns void language plpgsql security definer as $$
begin
  delete from teacher_memos;
  delete from attendance;
  delete from student_answer;
  delete from week_score;
  delete from exam_question_tag;
  delete from exam_question;
  delete from week;
  delete from class_student;
  delete from student;
  delete from class_period;
  delete from class;
  delete from concept_tag;
  delete from concept_category;
  delete from teacher;
end;
$$;
