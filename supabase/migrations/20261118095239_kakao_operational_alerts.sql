create table if not exists public.kakao_operational_token (
  id integer primary key check (id = 1),
  refresh_token text not null,
  access_token text,
  access_expires_at timestamptz,
  refresh_locked_until timestamptz not null default '-infinity'
);

create table if not exists public.kakao_operational_delivery (
  event_id text primary key check (event_id ~ '^[a-f0-9]{32}$'),
  received_at timestamptz not null default now()
);

alter table public.kakao_operational_token enable row level security;
alter table public.kakao_operational_delivery enable row level security;

revoke all on public.kakao_operational_token, public.kakao_operational_delivery from public, anon, authenticated;
grant select, insert, update, delete on public.kakao_operational_token, public.kakao_operational_delivery to service_role;
