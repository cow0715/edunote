-- Organization aggregates are private server data, never app request events.
create table if not exists public.cost_claude_report (
  month text primary key check (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  report jsonb not null check (jsonb_typeof(report) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.cost_claude_report enable row level security;
revoke all on public.cost_claude_report from public, anon, authenticated;
grant all on public.cost_claude_report to service_role;
