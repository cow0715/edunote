create table if not exists prompts (
  key text primary key,
  content text not null,
  updated_at timestamptz default now()
);
