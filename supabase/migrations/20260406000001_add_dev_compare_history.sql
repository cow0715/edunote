create table if not exists dev_compare_history (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid references teacher(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  fn_id      text not null,
  fn_label   text not null,
  file_name  text,
  results    jsonb not null default '{}',
  note       text not null default ''
);

create index if not exists dev_compare_history_teacher_id_idx
  on dev_compare_history (teacher_id, created_at desc);

alter table dev_compare_history enable row level security;

create policy "본인 히스토리만 접근"
  on dev_compare_history
  for all
  using (
    teacher_id = (
      select id from teacher where auth_id = auth.uid()
    )
  );
