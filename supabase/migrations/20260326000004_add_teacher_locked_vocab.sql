alter table student_vocab_answer add column if not exists teacher_locked boolean not null default false;
