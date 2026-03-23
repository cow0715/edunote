-- EduNote 전체 스키마
-- 적용 순서: FK 의존성 순서대로

-- ────────────────────────────────────────────────────────────
-- 1. teacher
-- ────────────────────────────────────────────────────────────
create table if not exists teacher (
  id          uuid primary key default gen_random_uuid(),
  auth_id     uuid not null unique,
  email       text not null,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- 2. concept_category
-- ────────────────────────────────────────────────────────────
create table if not exists concept_category (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references teacher(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- 3. concept_tag
-- ────────────────────────────────────────────────────────────
create table if not exists concept_tag (
  id                   uuid primary key default gen_random_uuid(),
  teacher_id           uuid not null references teacher(id) on delete cascade,
  concept_category_id  uuid references concept_category(id) on delete set null,
  name                 text not null,
  sort_order           int  not null default 0,
  created_at           timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- 4. class
-- ────────────────────────────────────────────────────────────
create table if not exists class (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid not null references teacher(id) on delete cascade,
  name           text not null,
  description    text,
  start_date     date not null,
  end_date       date not null,
  schedule_days  text[] not null default '{}',
  created_at     timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- 5. student
-- ────────────────────────────────────────────────────────────
create table if not exists student (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid not null references teacher(id) on delete cascade,
  name          text not null,
  phone         text,
  father_phone  text,
  mother_phone  text,
  school        text,
  grade         text,
  memo          text,
  share_token   text not null unique default gen_random_uuid()::text,
  created_at    timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- 6. class_student
-- ────────────────────────────────────────────────────────────
create table if not exists class_student (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references class(id) on delete cascade,
  student_id  uuid not null references student(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (class_id, student_id)
);

-- ────────────────────────────────────────────────────────────
-- 7. week
-- ────────────────────────────────────────────────────────────
create table if not exists week (
  id                 uuid primary key default gen_random_uuid(),
  class_id           uuid not null references class(id) on delete cascade,
  week_number        int  not null,
  start_date         date,
  vocab_total        int  not null default 0,
  reading_total      int  not null default 0,
  homework_total     int  not null default 0,
  answer_sheet_path  text,
  created_at         timestamptz not null default now(),
  unique (class_id, week_number)
);

-- ────────────────────────────────────────────────────────────
-- 8. exam_question
-- ────────────────────────────────────────────────────────────
create table if not exists exam_question (
  id                   uuid primary key default gen_random_uuid(),
  week_id              uuid not null references week(id) on delete cascade,
  question_number      int  not null,
  sub_label            text,
  correct_answer       int,
  correct_answer_text  text,
  grading_criteria     text,
  explanation          text,
  question_text        text,
  exam_type            text not null default 'reading', -- 'vocab' | 'reading'
  question_style       text not null default 'objective', -- 'objective' | 'subjective' | 'ox' | 'multi_select'
  created_at           timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- 9. exam_question_tag
-- ────────────────────────────────────────────────────────────
create table if not exists exam_question_tag (
  id               uuid primary key default gen_random_uuid(),
  exam_question_id uuid not null references exam_question(id) on delete cascade,
  concept_tag_id   uuid not null references concept_tag(id) on delete cascade,
  unique (exam_question_id, concept_tag_id)
);

-- ────────────────────────────────────────────────────────────
-- 10. exam_question_choice
-- ────────────────────────────────────────────────────────────
create table if not exists exam_question_choice (
  id               uuid primary key default gen_random_uuid(),
  exam_question_id uuid not null references exam_question(id) on delete cascade,
  choice_number    int  not null,
  concept_tag_id   uuid not null references concept_tag(id) on delete cascade,
  unique (exam_question_id, choice_number)
);

-- ────────────────────────────────────────────────────────────
-- 11. week_score
-- ────────────────────────────────────────────────────────────
create table if not exists week_score (
  id               uuid primary key default gen_random_uuid(),
  week_id          uuid not null references week(id) on delete cascade,
  student_id       uuid not null references student(id) on delete cascade,
  vocab_correct    int,
  reading_correct  int,
  homework_done    int,
  memo             text,
  created_at       timestamptz not null default now(),
  unique (week_id, student_id)
);

-- ────────────────────────────────────────────────────────────
-- 12. student_answer
-- ────────────────────────────────────────────────────────────
create table if not exists student_answer (
  id                  uuid primary key default gen_random_uuid(),
  week_score_id       uuid not null references week_score(id) on delete cascade,
  exam_question_id    uuid not null references exam_question(id) on delete cascade,
  student_answer      int,
  student_answer_text text,
  ox_selection        text,   -- 'O' | 'X' | null
  is_correct          boolean not null default false,
  ai_feedback         text,
  created_at          timestamptz not null default now(),
  unique (week_score_id, exam_question_id)
);

-- ────────────────────────────────────────────────────────────
-- 13. attendance
-- ────────────────────────────────────────────────────────────
create table if not exists attendance (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references class(id) on delete cascade,
  student_id  uuid not null references student(id) on delete cascade,
  date        date not null,
  status      text not null default 'present', -- 'present' | 'late' | 'absent'
  note        text,
  created_at  timestamptz not null default now(),
  unique (class_id, student_id, date)
);

-- ────────────────────────────────────────────────────────────
-- 14. teacher_memos
-- ────────────────────────────────────────────────────────────
create table if not exists teacher_memos (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references teacher(id) on delete cascade,
  student_id  uuid not null references student(id) on delete cascade,
  content     text not null,
  created_at  timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- 15. message_log
-- ────────────────────────────────────────────────────────────
create table if not exists message_log (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references student(id) on delete cascade,
  week_id     uuid not null references week(id) on delete cascade,
  message     text not null,
  sent_at     timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- 16. vocab_word
-- ────────────────────────────────────────────────────────────
create table if not exists vocab_word (
  id            uuid primary key default gen_random_uuid(),
  week_id       uuid not null references week(id) on delete cascade,
  number        int  not null,
  english_word  text not null,
  created_at    timestamptz not null default now(),
  unique (week_id, number)
);

-- ────────────────────────────────────────────────────────────
-- 17. student_vocab_answer
-- ────────────────────────────────────────────────────────────
create table if not exists student_vocab_answer (
  id              uuid primary key default gen_random_uuid(),
  week_score_id   uuid not null references week_score(id) on delete cascade,
  vocab_word_id   uuid not null references vocab_word(id) on delete cascade,
  student_answer  text,
  is_correct      boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (week_score_id, vocab_word_id)
);

-- ────────────────────────────────────────────────────────────
-- RLS: 운영 환경에서는 각 테이블에 맞는 정책 설정 필요
-- 개발 환경: 아래 주석 해제하여 전체 허용
-- ────────────────────────────────────────────────────────────
-- alter table teacher enable row level security;
-- create policy "allow all" on teacher using (true) with check (true);
-- (나머지 테이블도 동일하게 적용)
