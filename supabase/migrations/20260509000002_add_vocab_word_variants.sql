create table if not exists vocab_word_variant (
  id uuid primary key default gen_random_uuid(),
  vocab_word_id uuid not null references vocab_word(id) on delete cascade,
  word text not null,
  part_of_speech text,
  meaning text,
  relation_type text not null default 'original',
  usage_note text,
  excluded_meanings text[] not null default '{}',
  raw_text text,
  exam_enabled boolean not null default true,
  needs_review boolean not null default false,
  confidence numeric(4, 3),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint vocab_word_variant_relation_type_check
    check (relation_type in ('original', 'synonym', 'derivative', 'antonym'))
);

create index if not exists idx_vocab_word_variant_word_id_sort
  on vocab_word_variant(vocab_word_id, sort_order);

create index if not exists idx_vocab_word_variant_exam_enabled
  on vocab_word_variant(exam_enabled)
  where exam_enabled = true;

create index if not exists idx_vocab_word_variant_relation_type
  on vocab_word_variant(relation_type);

alter table vocab_test_item
  add column if not exists vocab_word_variant_id uuid references vocab_word_variant(id) on delete set null;

create index if not exists idx_vocab_test_item_variant_id
  on vocab_test_item(vocab_word_variant_id);

alter table student_vocab_answer
  add column if not exists vocab_word_variant_id uuid references vocab_word_variant(id) on delete set null;

create index if not exists idx_student_vocab_answer_variant_id
  on student_vocab_answer(vocab_word_variant_id);

alter table vocab_word_variant enable row level security;

drop policy if exists "vocab_word_variant_owner" on vocab_word_variant;
create policy "vocab_word_variant_owner" on vocab_word_variant
  for all using (
    vocab_word_id in (
      select vw.id
      from vocab_word vw
      join week w on w.id = vw.week_id
      join class c on c.id = w.class_id
      where c.teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  )
  with check (
    vocab_word_id in (
      select vw.id
      from vocab_word vw
      join week w on w.id = vw.week_id
      join class c on c.id = w.class_id
      where c.teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  );
