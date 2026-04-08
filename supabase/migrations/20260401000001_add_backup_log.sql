create table if not exists backup_log (
  id          bigint generated always as identity primary key,
  triggered_by text not null default 'cron',  -- 'cron' | 'manual'
  status      text not null,                  -- 'success' | 'error'
  file_name   text,
  error_msg   text,
  row_counts  jsonb,
  created_at  timestamptz not null default now()
);

-- 내부 로그 테이블이므로 RLS 불필요
alter table backup_log disable row level security;
