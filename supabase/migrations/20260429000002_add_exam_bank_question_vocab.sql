-- Structured vocabulary extracted from exam_bank_question.explanation_vocabulary.

create table if not exists exam_bank_question_vocab (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references exam_bank_question(id) on delete cascade,
  word text not null,
  normalized_word text not null,
  meaning text not null default '',
  topic text not null default '기타',
  synonyms text[] not null default '{}',
  antonyms text[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (question_id, normalized_word, meaning)
);

alter table exam_bank_question_vocab enable row level security;

create policy "exam_bank_question_vocab_owner" on exam_bank_question_vocab
  for all using (
    question_id in (
      select ebq.id
      from exam_bank_question ebq
      join exam_bank eb on eb.id = ebq.exam_bank_id
      join teacher t on t.id = eb.teacher_id
      where t.auth_id = auth.uid()
    )
  );

create index if not exists idx_exam_bank_question_vocab_question
  on exam_bank_question_vocab(question_id, sort_order);

create index if not exists idx_exam_bank_question_vocab_normalized
  on exam_bank_question_vocab(normalized_word);
