create table if not exists vocab_test (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references week(id) on delete cascade,
  title text not null default '단어시험',
  is_active boolean not null default true,
  item_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vocab_test_week_id on vocab_test(week_id);
create index if not exists idx_vocab_test_week_active on vocab_test(week_id, is_active);

create table if not exists vocab_test_item (
  id uuid primary key default gen_random_uuid(),
  vocab_test_id uuid not null references vocab_test(id) on delete cascade,
  vocab_word_id uuid not null references vocab_word(id) on delete cascade,
  test_number int not null,
  sort_order int not null,
  created_at timestamptz not null default now(),
  unique(vocab_test_id, test_number),
  unique(vocab_test_id, vocab_word_id)
);

create index if not exists idx_vocab_test_item_test_id on vocab_test_item(vocab_test_id);
create index if not exists idx_vocab_test_item_word_id on vocab_test_item(vocab_word_id);

alter table student_vocab_answer
  add column if not exists test_number int;

alter table vocab_test enable row level security;
alter table vocab_test_item enable row level security;

drop policy if exists "vocab_test_owner" on vocab_test;
create policy "vocab_test_owner" on vocab_test
  for all using (
    week_id in (
      select w.id
      from week w
      join class c on c.id = w.class_id
      where c.teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  )
  with check (
    week_id in (
      select w.id
      from week w
      join class c on c.id = w.class_id
      where c.teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  );

drop policy if exists "vocab_test_item_owner" on vocab_test_item;
create policy "vocab_test_item_owner" on vocab_test_item
  for all using (
    vocab_test_id in (
      select vt.id
      from vocab_test vt
      join week w on w.id = vt.week_id
      join class c on c.id = w.class_id
      where c.teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  )
  with check (
    vocab_test_id in (
      select vt.id
      from vocab_test vt
      join week w on w.id = vt.week_id
      join class c on c.id = w.class_id
      where c.teacher_id in (select id from teacher where auth_id = auth.uid())
    )
  );
