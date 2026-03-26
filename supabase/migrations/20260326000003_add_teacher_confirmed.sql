alter table student_answer
  add column if not exists teacher_confirmed boolean not null default false;
