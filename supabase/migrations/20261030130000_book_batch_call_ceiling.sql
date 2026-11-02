-- Local artifact only: apply manually after cost-controls (and bundles, if used).
-- Does not resume jobs, change existing limits or send provider requests.
begin;
alter table public.book_pdf_cost_control add column if not exists call_limit integer not null default 1000 check(call_limit>0);
do $$ begin
 if to_regprocedure('public.book_pdf_cost_summary_before_call_cap(uuid,uuid)') is null then
  alter function public.book_pdf_cost_summary(uuid,uuid) rename to book_pdf_cost_summary_before_call_cap;
 end if;
 if to_regprocedure('public.book_pdf_batch_prepare_before_call_cap(uuid,uuid,jsonb)') is null then
  alter function public.book_pdf_batch_prepare(uuid,uuid,jsonb) rename to book_pdf_batch_prepare_before_call_cap;
 end if;
end $$;

create or replace function public.book_pdf_cost_summary(p_job uuid,p_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare info jsonb; doc uuid; ceiling integer; used bigint;
begin
 info=public.book_pdf_cost_summary_before_call_cap(p_job,p_token);
 select target_id into doc from public.pdf_import_job where id=p_job and kind='bank_book';
 select call_limit into ceiling from public.book_pdf_cost_control where document_id=doc;
 -- Count submissions, including uncertain and rejected requests, across all jobs
 -- for the same document. New prompt keys/protocols never reset this ceiling.
 select coalesce(sum(jsonb_array_length(b.requests)),0) into used
 from public.book_pdf_batch b join public.pdf_import_job j on j.id=b.job_id
 where j.kind='bank_book' and j.target_id=doc and not coalesce((b.state='rejected' and b.outcomes->>'__not_sent__'='deferred'),false);
 return info || jsonb_build_object('call_limit',ceiling,'calls_used',used)
  -- A batch already prepared at exactly the ceiling still needs its dollar
  -- reservation. prepare and the client enforce used + NEW requests <= ceiling.
  || case when used>ceiling then jsonb_build_object('allowed',false,'reason',coalesce(info->>'reason','file_call_limit')) else '{}'::jsonb end;
end $$;

create or replace function public.book_pdf_batch_prepare(p_job uuid,p_token uuid,p_requests jsonb)
returns setof public.book_pdf_batch language plpgsql security invoker set search_path='' as $$
declare doc uuid; import_kind text; ceiling integer; used bigint;
begin
 select kind,target_id into import_kind,doc from public.pdf_import_job where id=p_job
  and status='running' and lease_token=p_token and lease_expires_at>now() for update;
 if not found then raise exception 'worker lease lost'; end if;
 if import_kind='bank_book' then
  insert into public.book_pdf_cost_control(document_id) values(doc) on conflict do nothing;
  select call_limit into ceiling from public.book_pdf_cost_control where document_id=doc for update;
  if jsonb_typeof(p_requests) is distinct from 'array' or jsonb_array_length(p_requests) not between 1 and 10 then raise exception 'invalid book request count'; end if;
  select coalesce(sum(jsonb_array_length(b.requests)),0) into used
  from public.book_pdf_batch b join public.pdf_import_job j on j.id=b.job_id
  where j.kind='bank_book' and j.target_id=doc and not coalesce((b.state='rejected' and b.outcomes->>'__not_sent__'='deferred'),false);
  if used+jsonb_array_length(p_requests)>ceiling then raise exception 'file cumulative call limit exceeded'; end if;
 end if;
 return query select * from public.book_pdf_batch_prepare_before_call_cap(p_job,p_token,p_requests);
end $$;
revoke all on function public.book_pdf_cost_summary(uuid,uuid),public.book_pdf_batch_prepare(uuid,uuid,jsonb),
 public.book_pdf_cost_summary_before_call_cap(uuid,uuid),public.book_pdf_batch_prepare_before_call_cap(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.book_pdf_cost_summary(uuid,uuid),public.book_pdf_batch_prepare(uuid,uuid,jsonb),
 public.book_pdf_cost_summary_before_call_cap(uuid,uuid),public.book_pdf_batch_prepare_before_call_cap(uuid,uuid,jsonb) to service_role;
commit;
