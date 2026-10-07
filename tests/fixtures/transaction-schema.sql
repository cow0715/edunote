-- Synthetic fixture, never apply to Supabase. Mirrors the pilot's four tables.
create schema auth;
create schema extensions;
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
$$;
create table teacher (
  id uuid primary key, auth_id uuid not null unique, approval_status text not null default 'approved'
);
create table class (
  id uuid primary key default gen_random_uuid(), teacher_id uuid not null references teacher,
  name text not null, description text, start_date date not null, end_date date not null,
  schedule_days text[] default '{}', created_at timestamptz default now(),
  academic_year int, school_name text, grade_level int, archived_at timestamptz,
  class_type text not null default 'regular'
);
create table class_period (
  id uuid primary key default gen_random_uuid(), class_id uuid not null references class on delete cascade,
  label text not null, semester int not null check(semester in (1,2)),
  exam_type text not null default 'other' check(exam_type in ('other','midterm','final')),
  start_date date not null, end_date date, is_current boolean not null default false,
  sort_order int not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(end_date is null or end_date >= start_date)
);
create unique index idx_class_period_one_current on class_period(class_id) where is_current;
create table week (
  id uuid primary key default gen_random_uuid(), class_id uuid not null references class on delete cascade,
  week_number int not null, start_date date, vocab_total int default 0, reading_total int default 0,
  homework_total int default 0, answer_sheet_path text, created_at timestamptz default now(),
  vocab_source_type text not null default 'legacy', vocab_source_file_name text,
  vocab_source_uploaded_at timestamptz, vocab_examples_generated_at timestamptz,
  unique(class_id, week_number)
);
-- Dev's broad policies: the new restrictive role scope must still hold.
create policy dev_allow on teacher for all using (true) with check (true);
create policy dev_allow on class for all using (true) with check (true);
create policy dev_allow on week for all using (true) with check (true);
create policy period_owner on class_period for all using (
  class_id in (select id from class where teacher_id in (select id from teacher where auth_id = auth.uid()))
) with check (class_id in (select id from class where teacher_id in (select id from teacher where auth_id = auth.uid())));

insert into teacher(id,auth_id) values
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011'),
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000012');
insert into class(id,teacher_id,name,start_date,end_date,schedule_days) values
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','fixture','2026-01-01','2026-01-31','{mon}'),
 ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000002','other','2026-01-01','2026-01-31','{mon}');
