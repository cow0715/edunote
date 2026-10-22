-- Apply to development and production separately. Only server service_role accesses these tables.
create table if not exists public.cost_entry (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('vercel','supabase','naver','claude','solapi','gcp','other')),
  environment text not null check (environment in ('production','development','test')),
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  kind text not null check (kind in ('actual','estimate','topup','budget')),
  currency text not null check (currency in ('KRW','USD')),
  amount numeric(20,6) not null check (amount >= 0),
  note text not null default '' check (length(note) <= 200),
  source text not null default 'manual',
  updated_at timestamptz not null default now(),
  unique(provider,environment,month,kind,currency)
);
create table if not exists public.cost_usage_event (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  provider text not null,
  environment text not null check (environment in ('production','development','test')),
  feature text not null,
  model text not null default '',
  request_id text not null,
  units bigint not null default 1 check (units >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cache_read_tokens bigint not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens bigint not null default 0 check (cache_write_tokens >= 0),
  unique(provider,environment,request_id)
);
create index if not exists cost_usage_event_period on public.cost_usage_event(environment,occurred_at);
alter table public.cost_entry enable row level security;
alter table public.cost_usage_event enable row level security;
revoke all on public.cost_entry, public.cost_usage_event from public, anon, authenticated;
grant all on public.cost_entry, public.cost_usage_event to service_role;
grant usage, select on sequence public.cost_usage_event_id_seq to service_role;

create or replace function public.cost_usage_summary(p_start timestamptz, p_end timestamptz, p_environment text)
returns table(provider text, feature text, model text, calls bigint, units numeric,
 input_tokens numeric, output_tokens numeric, cache_read_tokens numeric, cache_write_tokens numeric)
language sql stable security invoker set search_path = '' as $$
 select e.provider,e.feature,e.model,count(*),sum(e.units),sum(e.input_tokens),sum(e.output_tokens),sum(e.cache_read_tokens),sum(e.cache_write_tokens)
 from public.cost_usage_event e
 where e.occurred_at >= p_start and e.occurred_at < p_end and e.environment = p_environment
 group by e.provider,e.feature,e.model;
$$;
revoke all on function public.cost_usage_summary(timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.cost_usage_summary(timestamptz,timestamptz,text) to service_role;

create table if not exists public.cost_provider_snapshot (
  provider text not null,
  month text not null,
  metric text not null,
  currency text not null,
  amount numeric(20,6),
  status text not null default 'ok' check (status in ('ok','error')),
  updated_at timestamptz not null default now(),
  primary key(provider,month,metric)
);
alter table public.cost_provider_snapshot enable row level security;
revoke all on public.cost_provider_snapshot from public,anon,authenticated;
grant all on public.cost_provider_snapshot to service_role;
