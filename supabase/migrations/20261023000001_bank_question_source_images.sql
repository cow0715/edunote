-- Private image paths only; signed URLs are issued after checking bank ownership.
alter table public.exam_bank_question add column if not exists source_images jsonb not null default '[]'::jsonb;
notify pgrst, 'reload schema';
