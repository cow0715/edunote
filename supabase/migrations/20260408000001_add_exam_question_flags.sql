alter table exam_question
  add column if not exists is_void boolean not null default false,
  add column if not exists all_correct boolean not null default false;
