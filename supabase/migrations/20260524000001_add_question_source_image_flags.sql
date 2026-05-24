alter table exam_question
  add column if not exists needs_source_image boolean not null default false,
  add column if not exists source_image_reason text,
  add column if not exists source_page integer,
  add column if not exists source_bbox jsonb,
  add column if not exists source_image_path text;

notify pgrst, 'reload schema';
