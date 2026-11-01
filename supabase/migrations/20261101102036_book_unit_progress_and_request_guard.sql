-- Progress can advance without rewriting immutable paid responses. No jobs are
-- resumed and no costs, caps, provider responses or publication data are changed.
begin;
create or replace function public.book_pdf_save_unit_progress(p_job uuid,p_token uuid,p_unit text,p_key text,p_value jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare doc uuid; pdf_hash text; old_value jsonb; step text;
begin
 select target_id into doc from public.pdf_import_job where id=p_job and kind='bank_book'
  and status='running' and lease_token=p_token and lease_expires_at>now() for update;
 if not found then raise exception 'worker lease lost'; end if;
 select source_sha256 into pdf_hash from public.book_pdf_document where id=doc;
 step=p_value->>'stage';
 if p_key !~ '^book-unit-stage:v1:[a-f0-9]{64}$' or p_unit !~ '^unit-[0-9]+$'
  or p_value->>'version' is distinct from '1' or coalesce(step,'') not in ('mapping','audit','source','enrichment','complete','progress')
  or p_value->>'unitKey' is distinct from p_unit
  or p_value->'scope'->>'pdfHash' is distinct from pdf_hash or pdf_hash is null
  or coalesce(p_value->'scope'->>'sourceHash','') !~ '^[a-f0-9]{64}$'
  or coalesce(p_value->>'hash','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_value->'json') is distinct from 'string'
  or not exists(select 1 from public.book_pdf_unit where document_id=doc and unit_key=p_unit)
  then raise exception 'invalid textbook progress'; end if;
 perform (p_value->>'json')::jsonb;
 select value into old_value from public.pdf_import_checkpoint where job_id=p_job and call_key=p_key;
 if old_value is not null and (old_value->'scope' is distinct from p_value->'scope' or old_value->>'stage' is distinct from step
  or (step in ('source','complete') and old_value is distinct from p_value)) then raise exception 'accepted textbook stage cannot be replaced'; end if;
 insert into public.pdf_import_checkpoint(job_id,call_key,value) values(p_job,p_key,p_value)
  on conflict(job_id,call_key) do update set value=excluded.value;
end $$;

do $$ begin
 if to_regprocedure('public.book_pdf_batch_prepare_before_unit_guard(uuid,uuid,jsonb)') is null then
  alter function public.book_pdf_batch_prepare(uuid,uuid,jsonb) rename to book_pdf_batch_prepare_before_unit_guard;
 end if;
 if to_regprocedure('public.book_pdf_cost_summary_before_unit_guard(uuid,uuid)') is null then
  alter function public.book_pdf_cost_summary(uuid,uuid) rename to book_pdf_cost_summary_before_unit_guard;
 end if;
end $$;
create or replace function public.book_pdf_cost_summary(p_job uuid,p_token uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select public.book_pdf_cost_summary_before_unit_guard(p_job,p_token)||jsonb_build_object('unit_guard_version',1);
$$;

create or replace function public.book_pdf_batch_prepare(p_job uuid,p_token uuid,p_requests jsonb)
returns setof public.book_pdf_batch language plpgsql security invoker set search_path='' as $$
declare doc uuid; import_kind text; item jsonb; previous record; outcome text;
begin
 select kind,target_id into import_kind,doc from public.pdf_import_job where id=p_job
  and status='running' and lease_token=p_token and lease_expires_at>now() for update;
 if not found then raise exception 'worker lease lost'; end if;
 if import_kind='bank_book' then
  -- Serialize across replacement jobs too, not just one worker's in-memory map.
  perform 1 from public.book_pdf_document where id=doc for update;
  if jsonb_typeof(p_requests) is distinct from 'array' or jsonb_array_length(p_requests) not between 1 and 10 then raise exception 'invalid book request count'; end if;
  if (select count(*) from jsonb_array_elements(p_requests))<>(select count(distinct x->>'semanticKey') from jsonb_array_elements(p_requests) x) then raise exception 'duplicate textbook evidence in batch'; end if;
  for item in select value from jsonb_array_elements(p_requests) loop
   if coalesce(item->>'semanticKey','') !~ '^[a-f0-9]{64}$' or coalesce(item->>'unitKey','') !~ '^unit-[0-9]+$'
    or not exists(select 1 from public.book_pdf_unit where document_id=doc and unit_key=item->>'unitKey')
    then raise exception 'missing textbook semantic identity'; end if;
   if exists(select 1 from public.pdf_import_checkpoint c join public.pdf_import_job j on j.id=c.job_id
    where j.target_id=doc and j.kind='bank_book' and c.call_key='book-semantic-result:v1:'||(item->>'semanticKey'))
    then raise exception 'textbook response already received'; end if;
   for previous in select b.state,b.outcomes,r from public.book_pdf_batch b join public.pdf_import_job j on j.id=b.job_id
    cross join lateral jsonb_array_elements(b.requests) r where j.target_id=doc and j.kind='bank_book'
     and (r->>'semanticKey'=item->>'semanticKey' or r->>'key'=item->>'key')
     and not coalesce(b.state='rejected' and b.outcomes->>'__not_sent__'='deferred',false) loop
    outcome=previous.outcomes->>(previous.r->>'key');
    if previous.r->>'key' is distinct from item->>'key' or previous.state in ('submitting','submitted')
     or not coalesce((previous.state='ended' and outcome in ('expired','api_error','overloaded_error','rate_limit_error','timeout_error'))
      or (previous.state='rejected' and outcome='http_429'),false)
     then raise exception 'duplicate or uncertain textbook evidence request'; end if;
   end loop;
  end loop;
 end if;
 -- Retain the existing dollar cap, call ceiling and bounded transient retries.
 return query select * from public.book_pdf_batch_prepare_before_unit_guard(p_job,p_token,p_requests);
end $$;
revoke all on function public.book_pdf_save_unit_progress(uuid,uuid,text,text,jsonb),public.book_pdf_batch_prepare(uuid,uuid,jsonb),
 public.book_pdf_cost_summary(uuid,uuid),public.book_pdf_batch_prepare_before_unit_guard(uuid,uuid,jsonb),public.book_pdf_cost_summary_before_unit_guard(uuid,uuid) from public,anon,authenticated;
grant execute on function public.book_pdf_save_unit_progress(uuid,uuid,text,text,jsonb),public.book_pdf_batch_prepare(uuid,uuid,jsonb),
 public.book_pdf_cost_summary(uuid,uuid),public.book_pdf_batch_prepare_before_unit_guard(uuid,uuid,jsonb),public.book_pdf_cost_summary_before_unit_guard(uuid,uuid) to service_role;
commit;
