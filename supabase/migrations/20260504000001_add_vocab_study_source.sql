alter table vocab_word
  add column if not exists passage_label text,
  add column if not exists part_of_speech text,
  add column if not exists derivatives text,
  add column if not exists source_row_index integer,
  add column if not exists example_source text;

alter table week
  add column if not exists vocab_source_type text not null default 'legacy',
  add column if not exists vocab_source_file_name text,
  add column if not exists vocab_source_uploaded_at timestamptz,
  add column if not exists vocab_examples_generated_at timestamptz;
