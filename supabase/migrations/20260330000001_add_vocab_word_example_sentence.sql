alter table vocab_word
  add column if not exists example_sentence text,
  add column if not exists example_translation text;
