-- Apply to development and production using each project's SQL Editor.
-- Existing rows retain their previous numbering/order until the source is reimported.
alter table public.exam_question
  add column if not exists source_section text check (source_section in ('general', 'written')),
  add column if not exists source_question_number integer check (source_question_number > 0),
  add column if not exists display_order integer check (display_order > 0),
  add column if not exists passage_group text,
  add column if not exists shared_passage text;

create index if not exists exam_question_pdf_order_idx
  on public.exam_question (week_id, display_order, question_number, sub_label);
