-- Store AI enrichment directly on structured exam vocabulary rows.
-- The separate vocab_enrichment cache table is no longer used.

alter table exam_bank_question_vocab
  add column if not exists similar_words text[] not null default '{}';

alter table vocab_collection_item
  add column if not exists similar_words text[] not null default '{}';

drop table if exists vocab_enrichment;
