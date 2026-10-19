-- Apply in development and production before enabling PDF_IMPORT_WORKER_ENABLED.
create table if not exists public.pdf_import_job (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teacher(id) on delete cascade,
  kind text not null check (kind in ('bank_questions','bank_explanation','week_answers')),
  target_id uuid not null,
  source_path text not null,
  upload_path text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  stage text not null default '실행 대기',
  completed_calls integer not null default 0,
  attempt integer not null default 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id, kind, upload_path)
);
create unique index if not exists pdf_import_active_target
  on public.pdf_import_job(target_id) where status in ('queued','running');
create index if not exists pdf_import_owner_created on public.pdf_import_job(teacher_id, created_at desc);
alter table public.pdf_import_job enable row level security;
create policy pdf_import_owner_read on public.pdf_import_job for select to authenticated
  using (teacher_id in (select id from public.teacher where auth_id = (select auth.uid())));
revoke all on public.pdf_import_job from public,anon,authenticated;
grant select on public.pdf_import_job to authenticated;
grant all on public.pdf_import_job to service_role;

create table if not exists public.pdf_import_checkpoint (
  job_id uuid not null references public.pdf_import_job(id) on delete cascade,
  call_key text not null,
  value jsonb not null,
  created_at timestamptz not null default now(),
  primary key (job_id, call_key)
);
alter table public.pdf_import_checkpoint enable row level security;
revoke all on public.pdf_import_checkpoint from public,anon,authenticated;
grant all on public.pdf_import_checkpoint to service_role;

-- No user upload policy: immutable originals are copied here only by the server.
insert into storage.buckets (id, name, public)
values ('pdf-import-sources', 'pdf-import-sources', false) on conflict (id) do update set public=false;
-- A restrictive policy also blocks any existing broad authenticated storage policy.
create policy pdf_import_sources_server_only on storage.objects as restrictive for all to anon,authenticated
  using (bucket_id <> 'pdf-import-sources') with check (bucket_id <> 'pdf-import-sources');

-- Row updates take a lock. An overlapping Cloud Run retry cannot claim a live lease.
create or replace function public.pdf_import_claim(p_id uuid, p_token uuid)
returns setof public.pdf_import_job language sql security invoker set search_path = '' as $$
  update public.pdf_import_job set status='running', lease_token=p_token,
    lease_expires_at=now()+interval '2 minutes', attempt=attempt+1, error=null, updated_at=now()
  where id=p_id and (status='queued' or (status='running' and lease_expires_at < now()))
  returning *;
$$;
create or replace function public.pdf_import_heartbeat(p_id uuid, p_token uuid, p_stage text default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.pdf_import_job set lease_expires_at=now()+interval '2 minutes',
    stage=coalesce(p_stage,stage), updated_at=now()
  where id=p_id and status='running' and lease_token=p_token and lease_expires_at > now();
  return found;
end;
$$;
create or replace function public.pdf_import_save_checkpoint(p_id uuid, p_token uuid, p_key text, p_value jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.pdf_import_job where id=p_id and status='running'
    and lease_token=p_token and lease_expires_at > now() for update;
  if not found then raise exception 'worker lease lost'; end if;
  insert into public.pdf_import_checkpoint(job_id,call_key,value) values(p_id,p_key,p_value)
    on conflict (job_id,call_key) do nothing;
  update public.pdf_import_job set completed_calls=(select count(*) from public.pdf_import_checkpoint where job_id=p_id),
    updated_at=now() where id=p_id;
end;
$$;
create or replace function public.pdf_import_finish(p_id uuid, p_token uuid, p_status text, p_result jsonb, p_error text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_status not in ('queued','succeeded','failed') then raise exception 'invalid status'; end if;
  update public.pdf_import_job set status=p_status, result=p_result, error=p_error,
    stage=case p_status when 'succeeded' then '완료' when 'failed' then '실패' else '재시도 대기' end,
    lease_token=null, lease_expires_at=null, updated_at=now()
  where id=p_id and status='running' and lease_token=p_token and lease_expires_at > now();
  return found;
end;
$$;
create or replace function public.pdf_import_retry(p_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.pdf_import_job set status='queued', stage='재실행 대기', error=null,
    lease_token=null, lease_expires_at=null, updated_at=now()
  where id=p_id and (status in ('queued','failed') or (status='running' and lease_expires_at < now()));
  return found;
end;
$$;
revoke all on function public.pdf_import_claim(uuid,uuid) from public,anon,authenticated;
revoke all on function public.pdf_import_heartbeat(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.pdf_import_save_checkpoint(uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.pdf_import_finish(uuid,uuid,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.pdf_import_retry(uuid) from public,anon,authenticated;
grant execute on function public.pdf_import_claim(uuid,uuid) to service_role;
grant execute on function public.pdf_import_heartbeat(uuid,uuid,text) to service_role;
grant execute on function public.pdf_import_save_checkpoint(uuid,uuid,text,jsonb) to service_role;
grant execute on function public.pdf_import_finish(uuid,uuid,text,jsonb,text) to service_role;
grant execute on function public.pdf_import_retry(uuid) to service_role;

-- Delete retryable records with the exam so a failed import cannot recreate a deleted exam.
-- Locking the job rows also serializes this operation against a concurrent manual retry.
create or replace function public.pdf_import_delete_exam(p_id uuid, p_teacher_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.exam_bank where id=p_id and teacher_id=p_teacher_id for update;
  if not found then return false; end if;
  perform 1 from public.pdf_import_job where target_id=p_id and teacher_id=p_teacher_id for update;
  if exists (select 1 from public.pdf_import_job where target_id=p_id and teacher_id=p_teacher_id and status in ('queued','running')) then
    raise exception 'PDF import is active' using errcode='55000';
  end if;
  delete from public.pdf_import_job where target_id=p_id and teacher_id=p_teacher_id;
  delete from public.exam_bank where id=p_id and teacher_id=p_teacher_id;
  return true;
end;
$$;
revoke all on function public.pdf_import_delete_exam(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pdf_import_delete_exam(uuid,uuid) to service_role;
