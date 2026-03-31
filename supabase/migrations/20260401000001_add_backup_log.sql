create table if not exists backup_log (
  id          bigint generated always as identity primary key,
  triggered_by text not null default 'cron',  -- 'cron' | 'manual'
  status      text not null,                  -- 'success' | 'error'
  file_name   text,
  error_msg   text,
  row_counts  jsonb,
  created_at  timestamptz not null default now()
);
