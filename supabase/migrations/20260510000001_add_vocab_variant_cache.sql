create table if not exists vocab_variant_cache (
  id uuid primary key default gen_random_uuid(),
  word_key text not null,
  word text not null,
  part_of_speech text,
  relation_type text not null,
  meaning text not null,
  usage_note text,
  excluded_meanings text[] not null default '{}',
  confidence numeric(4, 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vocab_variant_cache_relation_type_check
    check (relation_type in ('original', 'synonym', 'derivative', 'antonym')),
  part_of_speech_key text generated always as (coalesce(part_of_speech, '')) stored,
  unique (word_key, part_of_speech_key, relation_type)
);

create index if not exists idx_vocab_variant_cache_word_key
  on vocab_variant_cache(word_key);

create or replace function touch_vocab_variant_cache_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_vocab_variant_cache_updated_at on vocab_variant_cache;
create trigger trg_vocab_variant_cache_updated_at
  before update on vocab_variant_cache
  for each row
  execute function touch_vocab_variant_cache_updated_at();

alter table vocab_variant_cache enable row level security;

drop policy if exists "vocab_variant_cache_authenticated_read" on vocab_variant_cache;
create policy "vocab_variant_cache_authenticated_read" on vocab_variant_cache
  for select using (auth.uid() is not null);

drop policy if exists "vocab_variant_cache_authenticated_write" on vocab_variant_cache;
create policy "vocab_variant_cache_authenticated_write" on vocab_variant_cache
  for all using (auth.uid() is not null)
  with check (auth.uid() is not null);
