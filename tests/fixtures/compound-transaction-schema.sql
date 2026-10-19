-- Synthetic PostgreSQL fixture. Never apply to hosted Supabase.
create table public.concept_tag(id uuid primary key default gen_random_uuid(),teacher_id uuid references teacher(id),name text);
create table public.student (
  "id" uuid primary key not null default gen_random_uuid(),
  "teacher_id" uuid not null references teacher(id) on delete cascade,
  "name" text not null,
  "phone" text,
  "parent_phone" text,
  "father_phone" text,
  "mother_phone" text,
  "school" text,
  "grade" text,
  "memo" text,
  "share_token" uuid default gen_random_uuid(),
  "created_at" timestamptz default now(),
  "student_code" text,
  "previous_share_token" uuid,
  "previous_share_token_expires_at" timestamptz
);
create table public.class_student (
  "id" uuid primary key not null default gen_random_uuid(),
  "class_id" uuid not null references "class"(id) on delete cascade,
  "student_id" uuid not null references student(id) on delete cascade,
  "created_at" timestamptz default now(),
  "joined_at" timestamptz not null default now(),
  "left_at" timestamptz,
 unique(class_id,student_id)
);
create table public.clinic_enrollment (
  "id" uuid primary key not null default gen_random_uuid(),
  "teacher_id" uuid not null references teacher(id) on delete cascade,
  "student_id" uuid not null references student(id) on delete cascade,
  "clinic_slot_id" uuid not null,
  "start_date" date not null default CURRENT_DATE,
  "end_date" date,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);
create table public.exam_question (
  "id" uuid primary key not null default gen_random_uuid(),
  "week_id" uuid not null references week(id) on delete cascade,
  "question_number" int4 not null,
  "exam_type" text not null,
  "question_style" text,
  "correct_answer" int4 not null default 0,
  "correct_answer_text" text,
  "grading_criteria" text,
  "sub_label" text,
  "explanation" text,
  "question_text" text,
  "created_at" timestamptz default now(),
  "is_void" bool not null default false,
  "all_correct" bool not null default false,
  "extra_correct_answers" int4[] not null default '{}'::integer[],
  "needs_source_image" bool not null default false,
  "source_image_reason" text,
  "source_image_path" text,
  "source_page" int4,
  "source_bbox" jsonb,
  "question_stem" text,
  "passage" text,
  "choices" jsonb,
  "concept_analysis" jsonb
);
create table public.vocab_word (
  "id" uuid primary key not null default gen_random_uuid(),
  "week_id" uuid not null references week(id) on delete cascade,
  "number" int4 not null,
  "english_word" text not null,
  "created_at" timestamptz default now(),
  "correct_answer" text,
  "synonyms" text[],
  "antonyms" text[],
  "example_sentence" text,
  "example_translation" text,
  "passage_label" text,
  "part_of_speech" text,
  "derivatives" text,
  "source_row_index" int4,
  "example_source" text,
  "example_distractor" text,
 unique(week_id,number)
);
create table public.vocab_word_variant (
  "id" uuid primary key not null default gen_random_uuid(),
  "vocab_word_id" uuid not null references vocab_word(id) on delete cascade,
  "word" text not null,
  "part_of_speech" text,
  "meaning" text,
  "relation_type" text not null default 'original'::text,
  "usage_note" text,
  "excluded_meanings" text[] not null default '{}'::text[],
  "raw_text" text,
  "exam_enabled" bool not null default true,
  "needs_review" bool not null default false,
  "confidence" numeric,
  "sort_order" int4 not null default 0,
  "created_at" timestamptz not null default now()
);
create table public.week_score (
  "id" uuid primary key not null default gen_random_uuid(),
  "week_id" uuid not null references week(id) on delete cascade,
  "student_id" uuid not null references student(id) on delete cascade,
  "vocab_correct" int4,
  "reading_correct" numeric,
  "homework_done" numeric,
  "memo" text,
  "created_at" timestamptz default now(),
  "vocab_photo_path" text,
  "vocab_retake_correct" int4,
  "exam_photo_path" text,
 unique(week_id,student_id)
);
create table public.student_answer (
  "id" uuid primary key not null default gen_random_uuid(),
  "week_score_id" uuid not null references week_score(id) on delete cascade,
  "exam_question_id" uuid not null references exam_question(id) on delete cascade,
  "student_answer" int4,
  "student_answer_text" text,
  "is_correct" bool not null default false,
  "ai_feedback" text,
  "ox_selection" text,
  "created_at" timestamptz default now(),
  "needs_review" bool not null default false,
  "teacher_confirmed" bool not null default false,
 unique(week_score_id,exam_question_id)
);
create table public.student_vocab_answer (
  "id" uuid primary key not null default gen_random_uuid(),
  "week_score_id" uuid not null references week_score(id) on delete cascade,
  "vocab_word_id" uuid not null references vocab_word(id) on delete cascade,
  "student_answer" text,
  "is_correct" bool not null default false,
  "created_at" timestamptz default now(),
  "teacher_locked" bool not null default false,
  "retake_answer" text,
  "retake_is_correct" bool,
  "test_number" int4,
  "test_word" text,
  "test_source" text,
  "vocab_word_variant_id" uuid references vocab_word_variant(id) on delete cascade,
 unique(week_score_id,vocab_word_id)
);


create table if not exists vocab_test (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references week(id) on delete cascade,
  title text not null default '단어시험',
  is_active boolean not null default true,
  item_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vocab_test_item (
  id uuid primary key default gen_random_uuid(),
  vocab_test_id uuid not null references vocab_test(id) on delete cascade,
  vocab_word_id uuid not null references vocab_word(id) on delete cascade,
  test_number int not null,
  sort_order int not null,
  created_at timestamptz not null default now(),
  unique(vocab_test_id, test_number),
  unique(vocab_test_id, vocab_word_id)
);

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
alter table vocab_test_item add column vocab_word_variant_id uuid references vocab_word_variant on delete set null, add column prompt_source text, add column prompt_text text;
create table public.exam_question_tag(exam_question_id uuid references exam_question on delete cascade,concept_tag_id uuid references concept_tag on delete cascade,primary key(exam_question_id,concept_tag_id));

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
create table clinic_slot(id uuid primary key,teacher_id uuid references teacher);
