alter table vocab_test_item
  add column if not exists prompt_source text not null default 'word',
  add column if not exists prompt_text text;

alter table student_vocab_answer
  add column if not exists test_word text,
  add column if not exists test_source text;
