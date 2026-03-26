alter table student_answer
  add column if not exists needs_review boolean not null default false;
