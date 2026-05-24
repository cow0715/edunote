alter table exam_question
  add column if not exists question_stem text,
  add column if not exists passage text,
  add column if not exists choices jsonb;

notify pgrst, 'reload schema';
