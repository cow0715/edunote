-- Disposable, synthetic PostgreSQL schema. Never connected to Supabase.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
create table teacher(id uuid primary key,auth_id uuid not null,approval_status text not null default 'approved');
create table class(id uuid primary key,teacher_id uuid references teacher);
create table class_student(class_id uuid references class,student_id uuid,primary key(class_id,student_id));
create table week(id uuid primary key,class_id uuid references class,vocab_total int default 0,reading_total int default 0);
create table exam_question(id uuid primary key,week_id uuid references week,exam_type text default 'reading',is_void boolean default false);
create table week_score(id uuid primary key default gen_random_uuid(),week_id uuid references week,student_id uuid,
  vocab_correct int,reading_correct numeric,homework_done numeric,memo text,vocab_photo_path text,exam_photo_path text,
  unique(week_id,student_id));
create table student_answer(id uuid primary key default gen_random_uuid(),week_score_id uuid references week_score on delete cascade,
  exam_question_id uuid references exam_question,student_answer int,student_answer_text text,ox_selection text,is_correct boolean not null,
  needs_review boolean default false,teacher_confirmed boolean default false,ai_feedback text,unique(week_score_id,exam_question_id));
create table vocab_word(id uuid primary key default gen_random_uuid(),week_id uuid references week,number int,english_word text,
  unique(week_id,number));
create table vocab_word_variant(id uuid primary key,vocab_word_id uuid references vocab_word);
create table vocab_test(id uuid primary key,week_id uuid references week,is_active boolean,created_at timestamptz default now());
create table vocab_test_item(vocab_test_id uuid references vocab_test,vocab_word_id uuid references vocab_word,
  test_number int,vocab_word_variant_id uuid references vocab_word_variant);
create table student_vocab_answer(id uuid primary key default gen_random_uuid(),week_score_id uuid references week_score on delete cascade,
  vocab_word_id uuid references vocab_word on delete cascade,vocab_word_variant_id uuid references vocab_word_variant,test_number int,
  test_word text,test_source text,student_answer text,is_correct boolean not null,teacher_locked boolean not null default false,
  unique(week_score_id,vocab_word_id));
grant select,insert,update,delete on all tables in schema public to authenticated;
