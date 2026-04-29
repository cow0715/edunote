-- 기출문제은행 기반 단어장

create table if not exists vocab_collection (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teacher(id) on delete cascade,
  title text not null,
  grade int not null default 3,
  year_from int not null,
  year_to int not null,
  months int[] not null default '{6,9,11}',
  item_count int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists vocab_collection_item (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references vocab_collection(id) on delete cascade,
  word text not null,
  meaning text not null default '',
  frequency int not null default 1,
  topic text not null default '기타',
  synonyms text[] not null default '{}',
  antonyms text[] not null default '{}',
  sources jsonb not null default '[]',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table vocab_collection enable row level security;
alter table vocab_collection_item enable row level security;

create policy "vocab_collection_owner" on vocab_collection
  for all using (
    teacher_id in (select id from teacher where auth_id = auth.uid())
  );

create policy "vocab_collection_item_owner" on vocab_collection_item
  for all using (
    collection_id in (
      select vc.id from vocab_collection vc
      join teacher t on t.id = vc.teacher_id
      where t.auth_id = auth.uid()
    )
  );

create index if not exists idx_vocab_collection_teacher
  on vocab_collection(teacher_id, created_at desc);

create index if not exists idx_vocab_collection_item_collection
  on vocab_collection_item(collection_id, sort_order);
