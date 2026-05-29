create table if not exists mock_exam (
  id uuid default gen_random_uuid() primary key,
  teacher_id uuid not null references teacher(id) on delete cascade,
  class_id uuid references class(id) on delete set null,
  title text not null,
  exam_year int not null,
  exam_month int not null check (exam_month between 1 and 12),
  grade int check (grade between 1 and 3),
  source text not null default 'education_office',
  exam_date date,
  total_score int not null default 100,
  grade_cutoffs jsonb not null default '{"1":90,"2":80,"3":70,"4":60,"5":50,"6":40,"7":30,"8":20}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'ready', 'published')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists mock_exam_question (
  id uuid default gen_random_uuid() primary key,
  mock_exam_id uuid not null references mock_exam(id) on delete cascade,
  question_number int not null check (question_number between 1 and 45),
  correct_answer text not null default '',
  points int not null default 2 check (points > 0),
  section text not null default 'reading' check (section in ('listening', 'reading')),
  question_type text not null default 'content_match',
  difficulty text not null default 'medium' check (difficulty in ('low', 'medium', 'high')),
  is_void boolean not null default false,
  all_correct boolean not null default false,
  extra_correct_answers jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (mock_exam_id, question_number)
);

create table if not exists mock_exam_question_tag (
  mock_exam_question_id uuid not null references mock_exam_question(id) on delete cascade,
  concept_tag_id uuid not null references concept_tag(id) on delete cascade,
  primary key (mock_exam_question_id, concept_tag_id)
);

create table if not exists mock_exam_result (
  id uuid default gen_random_uuid() primary key,
  mock_exam_id uuid not null references mock_exam(id) on delete cascade,
  student_id uuid not null references student(id) on delete cascade,
  raw_score int,
  grade int,
  listening_correct int not null default 0,
  listening_total int not null default 0,
  reading_correct int not null default 0,
  reading_total int not null default 0,
  type_analysis jsonb not null default '{}'::jsonb,
  teacher_comment text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (mock_exam_id, student_id)
);

create table if not exists mock_exam_student_answer (
  id uuid default gen_random_uuid() primary key,
  mock_exam_result_id uuid not null references mock_exam_result(id) on delete cascade,
  mock_exam_question_id uuid not null references mock_exam_question(id) on delete cascade,
  student_answer text,
  is_correct boolean not null default false,
  earned_points int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (mock_exam_result_id, mock_exam_question_id)
);

create table if not exists mock_exam_ocr_job (
  id uuid default gen_random_uuid() primary key,
  mock_exam_id uuid not null references mock_exam(id) on delete cascade,
  student_id uuid not null references student(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'review_required', 'completed', 'failed')),
  file_names jsonb not null default '[]'::jsonb,
  pages_processed int not null default 0,
  ocr_raw_json jsonb not null default '[]'::jsonb,
  confidence numeric,
  error_message text,
  reviewed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists mock_exam_report (
  id uuid default gen_random_uuid() primary key,
  mock_exam_result_id uuid not null references mock_exam_result(id) on delete cascade,
  share_token text not null default replace(gen_random_uuid()::text, '-', ''),
  snapshot_json jsonb not null,
  status text not null default 'published' check (status in ('published', 'revoked')),
  published_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (mock_exam_result_id),
  unique (share_token)
);

alter table mock_exam enable row level security;
alter table mock_exam_question enable row level security;
alter table mock_exam_question_tag enable row level security;
alter table mock_exam_result enable row level security;
alter table mock_exam_student_answer enable row level security;
alter table mock_exam_ocr_job enable row level security;
alter table mock_exam_report enable row level security;

create policy "mock_exam_owner" on mock_exam
  for all
  using (teacher_id in (select id from teacher where auth_id = auth.uid()))
  with check (teacher_id in (select id from teacher where auth_id = auth.uid()));

create policy "mock_exam_question_owner" on mock_exam_question
  for all
  using (
    mock_exam_id in (
      select id from mock_exam
      where teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  )
  with check (
    mock_exam_id in (
      select id from mock_exam
      where teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  );

create policy "mock_exam_question_tag_owner" on mock_exam_question_tag
  for all
  using (
    mock_exam_question_id in (
      select q.id from mock_exam_question q
      join mock_exam e on e.id = q.mock_exam_id
      where e.teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  )
  with check (
    mock_exam_question_id in (
      select q.id from mock_exam_question q
      join mock_exam e on e.id = q.mock_exam_id
      where e.teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  );

create policy "mock_exam_result_owner" on mock_exam_result
  for all
  using (
    mock_exam_id in (
      select id from mock_exam
      where teacher_id in (select id from teacher where auth_id = auth.uid())
    )
    and student_id in (
      select id from student
      where teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  )
  with check (
    mock_exam_id in (
      select id from mock_exam
      where teacher_id in (select id from teacher where auth_id = auth.uid())
    )
    and student_id in (
      select id from student
      where teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  );

create policy "mock_exam_student_answer_owner" on mock_exam_student_answer
  for all
  using (
    mock_exam_result_id in (
      select r.id from mock_exam_result r
      join mock_exam e on e.id = r.mock_exam_id
      where e.teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  )
  with check (
    mock_exam_result_id in (
      select r.id from mock_exam_result r
      join mock_exam e on e.id = r.mock_exam_id
      where e.teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  );

create policy "mock_exam_ocr_job_owner" on mock_exam_ocr_job
  for all
  using (
    mock_exam_id in (
      select id from mock_exam
      where teacher_id in (select id from teacher where auth_id = auth.uid())
    )
    and student_id in (
      select id from student
      where teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  )
  with check (
    mock_exam_id in (
      select id from mock_exam
      where teacher_id in (select id from teacher where auth_id = auth.uid())
    )
    and student_id in (
      select id from student
      where teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  );

create policy "mock_exam_report_owner" on mock_exam_report
  for all
  using (
    mock_exam_result_id in (
      select r.id from mock_exam_result r
      join mock_exam e on e.id = r.mock_exam_id
      where e.teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  )
  with check (
    mock_exam_result_id in (
      select r.id from mock_exam_result r
      join mock_exam e on e.id = r.mock_exam_id
      where e.teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  );

create index if not exists idx_mock_exam_teacher on mock_exam(teacher_id, created_at desc);
create index if not exists idx_mock_exam_class on mock_exam(class_id, created_at desc);
create index if not exists idx_mock_exam_question_exam on mock_exam_question(mock_exam_id, question_number);
create index if not exists idx_mock_exam_result_exam on mock_exam_result(mock_exam_id);
create index if not exists idx_mock_exam_result_student on mock_exam_result(student_id);
create index if not exists idx_mock_exam_ocr_job_exam on mock_exam_ocr_job(mock_exam_id, created_at desc);
create index if not exists idx_mock_exam_ocr_job_student on mock_exam_ocr_job(student_id, created_at desc);
create index if not exists idx_mock_exam_report_result on mock_exam_report(mock_exam_result_id);

create or replace function update_mock_exam_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_mock_exam_updated_at on mock_exam;
create trigger trg_mock_exam_updated_at
  before update on mock_exam
  for each row execute function update_mock_exam_updated_at();

drop trigger if exists trg_mock_exam_question_updated_at on mock_exam_question;
create trigger trg_mock_exam_question_updated_at
  before update on mock_exam_question
  for each row execute function update_mock_exam_updated_at();

drop trigger if exists trg_mock_exam_result_updated_at on mock_exam_result;
create trigger trg_mock_exam_result_updated_at
  before update on mock_exam_result
  for each row execute function update_mock_exam_updated_at();

drop trigger if exists trg_mock_exam_student_answer_updated_at on mock_exam_student_answer;
create trigger trg_mock_exam_student_answer_updated_at
  before update on mock_exam_student_answer
  for each row execute function update_mock_exam_updated_at();

drop trigger if exists trg_mock_exam_ocr_job_updated_at on mock_exam_ocr_job;
create trigger trg_mock_exam_ocr_job_updated_at
  before update on mock_exam_ocr_job
  for each row execute function update_mock_exam_updated_at();

drop trigger if exists trg_mock_exam_report_updated_at on mock_exam_report;
create trigger trg_mock_exam_report_updated_at
  before update on mock_exam_report
  for each row execute function update_mock_exam_updated_at();
