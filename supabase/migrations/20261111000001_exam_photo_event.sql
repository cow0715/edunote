create table if not exists public.exam_photo_event (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  week_id uuid not null,
  student_id uuid not null,
  photo_id uuid not null,
  stage text not null check (stage in ('received', 'upload', 'verify', 'ocr', 'grade_save')),
  outcome text not null check (outcome in ('started', 'succeeded', 'failed')),
  http_status integer,
  deployment_id text
);

alter table public.exam_photo_event enable row level security;
revoke all on public.exam_photo_event from public, anon, authenticated;
grant insert on public.exam_photo_event to service_role;

create index if not exists exam_photo_event_week_time_idx
  on public.exam_photo_event (week_id, occurred_at desc);
