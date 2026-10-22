-- Run in development and production SQL Editors before deploying Batch API support.
begin;
alter table public.pdf_import_job add column if not exists resume_after timestamptz;
alter table public.pdf_import_job drop constraint if exists pdf_import_job_status_check;
alter table public.pdf_import_job add constraint pdf_import_job_status_check
  check (status in ('queued','running','waiting_batch','succeeded','failed'));
alter table public.pdf_import_job drop constraint if exists pdf_import_job_batch_wait_check;
alter table public.pdf_import_job add constraint pdf_import_job_batch_wait_check
  check (status <> 'waiting_batch' or kind='bank_book');
drop index if exists public.pdf_import_active_target;
create unique index pdf_import_active_target on public.pdf_import_job(target_id)
  where status in ('queued','running','waiting_batch');

-- No PDF bytes/prompts here. Responses use the existing server-only checkpoint store.
create table if not exists public.book_pdf_batch (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.pdf_import_job(id) on delete cascade,
  state text not null check (state in ('submitting','submitted','ended','rejected')),
  provider_id text unique,
  requests jsonb not null check (jsonb_typeof(requests)='array' and jsonb_array_length(requests) between 1 and 1000),
  outcomes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists book_pdf_batch_job on public.book_pdf_batch(job_id,created_at);
alter table public.book_pdf_batch enable row level security;
revoke all on public.book_pdf_batch from public,anon,authenticated;
grant all on public.book_pdf_batch to service_role;

create or replace function public.pdf_import_claim(p_id uuid,p_token uuid)
returns setof public.pdf_import_job language sql security invoker set search_path='' as $$
  update public.pdf_import_job set status='running',lease_token=p_token,
    lease_expires_at=now()+interval '2 minutes',attempt=attempt+1,error=null,resume_after=null,updated_at=now()
  where id=p_id and (status='queued'
    or (status='waiting_batch' and resume_after<=now()+interval '5 seconds')
    or (status='running' and lease_expires_at<now()))
  returning *;
$$;

create or replace function public.pdf_import_suspend_batch(p_id uuid,p_token uuid,p_resume_at timestamptz)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  update public.pdf_import_job set status='waiting_batch',stage='배치 처리 대기 · 완료 후 자동으로 이어집니다',
    lease_token=null,lease_expires_at=null,resume_after=p_resume_at,updated_at=now()
  where id=p_id and kind='bank_book' and status='running' and lease_token=p_token and lease_expires_at>now();
  return found;
end $$;

create or replace function public.book_pdf_batch_prepare(p_job uuid,p_token uuid,p_requests jsonb)
returns setof public.book_pdf_batch language plpgsql security invoker set search_path='' as $$
declare item jsonb; total integer;
begin
  perform 1 from public.pdf_import_job where id=p_job and kind='bank_book'
    and status='running' and lease_token=p_token and lease_expires_at>now() for update;
  if not found then raise exception 'worker lease lost'; end if;
  if jsonb_typeof(p_requests)<>'array' or jsonb_array_length(p_requests) not between 1 and 1000 then raise exception 'invalid requests'; end if;
  if (select count(*) from jsonb_array_elements(p_requests))<>(select count(distinct r->>'key') from jsonb_array_elements(p_requests) r)
    then raise exception 'duplicate call keys'; end if;
  for item in select value from jsonb_array_elements(p_requests) loop
    if coalesce(item->>'key','') !~ '^[a-f0-9]{64}$' or coalesce(item->>'task','') not in ('book.mapSource','book.auditSource','book.enrichMaterial')
      or item ? 'content' or item ? 'params' then raise exception 'invalid batch identity'; end if;
    select count(*) into total from public.book_pdf_batch b
      where b.job_id=p_job and exists(select 1 from jsonb_array_elements(b.requests) r where r->>'key'=item->>'key');
    if total>=3 then raise exception 'batch request attempt limit'; end if;
    if exists(select 1 from public.book_pdf_batch b where b.job_id=p_job and b.state in ('submitting','submitted')
      and exists(select 1 from jsonb_array_elements(b.requests) r where r->>'key'=item->>'key')) then raise exception 'batch request already active'; end if;
  end loop;
  return query insert into public.book_pdf_batch(job_id,state,requests) values(p_job,'submitting',p_requests) returning *;
end $$;

create or replace function public.book_pdf_batch_update(p_job uuid,p_token uuid,p_batch uuid,p_state text,p_provider text,p_outcomes jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare old_state text;
begin
  perform 1 from public.pdf_import_job where id=p_job and kind='bank_book' and status='running'
    and lease_token=p_token and lease_expires_at>now() for update;
  if not found then raise exception 'worker lease lost'; end if;
  select state into old_state from public.book_pdf_batch where id=p_batch and job_id=p_job for update;
  if not found or not ((old_state='submitting' and p_state in ('submitted','rejected')) or (old_state='submitted' and p_state='ended'))
    then raise exception 'invalid batch transition'; end if;
  if p_state in ('submitted','ended') and coalesce(p_provider,'') !~ '^msgbatch_[a-zA-Z0-9_-]+$' then raise exception 'invalid provider batch'; end if;
  update public.book_pdf_batch set state=p_state,provider_id=p_provider,outcomes=p_outcomes,updated_at=now() where id=p_batch;
end $$;

-- Deletion must also respect suspended textbook work.
create or replace function public.pdf_import_delete_exam(p_id uuid,p_teacher_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare book_id uuid;
begin
  perform 1 from public.exam_bank where id=p_id and teacher_id=p_teacher_id for update;
  if not found then return false; end if;
  select id into book_id from public.book_pdf_document where exam_bank_id=p_id and teacher_id=p_teacher_id for update;
  perform 1 from public.pdf_import_job where target_id in (p_id,book_id) and teacher_id=p_teacher_id for update;
  if exists(select 1 from public.pdf_import_job where target_id in (p_id,book_id) and teacher_id=p_teacher_id and status in ('queued','running','waiting_batch'))
    then raise exception 'PDF import is active' using errcode='55000'; end if;
  delete from public.pdf_import_job where target_id in (p_id,book_id) and teacher_id=p_teacher_id;
  delete from public.exam_bank where id=p_id and teacher_id=p_teacher_id;
  return true;
end $$;

revoke all on function public.pdf_import_suspend_batch(uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.book_pdf_batch_prepare(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.book_pdf_batch_update(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.pdf_import_suspend_batch(uuid,uuid,timestamptz) to service_role;
grant execute on function public.book_pdf_batch_prepare(uuid,uuid,jsonb) to service_role;
grant execute on function public.book_pdf_batch_update(uuid,uuid,uuid,text,text,jsonb) to service_role;
commit;
