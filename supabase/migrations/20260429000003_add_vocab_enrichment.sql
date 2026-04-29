-- Cached AI enrichment for generated exam vocabulary collections.

alter table vocab_collection_item
  add column if not exists similar_words text[] not null default '{}';

create table if not exists vocab_enrichment (
  normalized_word text primary key,
  word text not null,
  meaning_sample text not null default '',
  topic text not null default '기타',
  synonyms text[] not null default '{}',
  antonyms text[] not null default '{}',
  similar_words text[] not null default '{}',
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table vocab_enrichment enable row level security;

drop policy if exists "vocab_enrichment_authenticated_read" on vocab_enrichment;
create policy "vocab_enrichment_authenticated_read" on vocab_enrichment
  for select using (auth.role() = 'authenticated');

drop policy if exists "vocab_enrichment_authenticated_insert" on vocab_enrichment;
create policy "vocab_enrichment_authenticated_insert" on vocab_enrichment
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "vocab_enrichment_authenticated_update" on vocab_enrichment;
create policy "vocab_enrichment_authenticated_update" on vocab_enrichment
  for update using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create index if not exists idx_vocab_enrichment_topic
  on vocab_enrichment(topic);
