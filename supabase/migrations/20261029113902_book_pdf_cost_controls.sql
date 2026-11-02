-- Apply in both SQL Editors before deploying. Does not start/resume any work.
begin;
alter table public.cost_usage_event add column if not exists service_tier text not null default 'standard'
  check (service_tier in ('standard','batch'));

create table if not exists public.book_pdf_cost_control (
  document_id uuid primary key references public.book_pdf_document(id) on delete cascade,
  limit_usd numeric(18,6) not null default 5 check (limit_usd>0),
  prior_usd numeric(18,6) not null default 0 check (prior_usd>=0),
  protocol text,
  stop_reason text,
  quality jsonb not null default '{}'::jsonb check (jsonb_typeof(quality)='object'),
  updated_at timestamptz not null default now()
);
create table if not exists public.pdf_batch_request_cost (
  batch_id uuid not null references public.book_pdf_batch(id) on delete cascade,
  call_key text not null,
  document_id uuid references public.book_pdf_document(id) on delete cascade,
  unit_key text,
  reserved_usd numeric(18,6) not null check (reserved_usd>=0),
  actual_usd numeric(18,6) check (actual_usd>=0),
  settled boolean not null default false,
  primary key(batch_id,call_key)
);
create index if not exists pdf_batch_request_cost_document on public.pdf_batch_request_cost(document_id);
alter table public.book_pdf_cost_control enable row level security;
alter table public.pdf_batch_request_cost enable row level security;
revoke all on public.book_pdf_cost_control,public.pdf_batch_request_cost from public,anon,authenticated;
grant all on public.book_pdf_cost_control,public.pdf_batch_request_cost to service_role;

-- Rates are Batch USD/M tokens, including the cached buckets, checked 2026-10-29.
create or replace function public.pdf_batch_token_cost(p_model text,p_usage jsonb)
returns numeric language sql immutable security invoker set search_path='' as $$
 select case when i>=0 and o>=0 and r>=0 and w>=0 then
  case regexp_replace(p_model,'-[0-9]{8}$','')
   when 'claude-sonnet-5-5' then (i+o*5+r*0.05+w*1.25)/1000000
   when 'claude-sonnet-5' then (i+o*5+r*0.1+w*1.25)/1000000
   when 'claude-opus-5-5' then (i*2+o*10+r*0.1+w*2.5)/1000000
   when 'claude-opus-5' then (i*2.5+o*12.5+r*0.25+w*3.125)/1000000
   when 'claude-sonnet-4-6' then (i*1.5+o*7.5+r*0.15+w*1.875)/1000000
   when 'claude-haiku-4-5' then (i*0.5+o*2.5+r*0.05+w*0.625)/1000000 end end
 from (select (p_usage->>'inputTokens')::numeric i,(p_usage->>'outputTokens')::numeric o,
  (p_usage->>'cacheReadTokens')::numeric r,(p_usage->>'cacheWriteTokens')::numeric w) t;
$$;

create or replace function public.book_pdf_cost_summary(p_job uuid,p_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare doc uuid; ctl public.book_pdf_cost_control; spent numeric; reserved numeric; unknown_count integer;
begin
 select target_id into doc from public.pdf_import_job where id=p_job and kind='bank_book'
  and status='running' and lease_token=p_token and lease_expires_at>now();
 if not found then raise exception 'worker lease lost'; end if;
 insert into public.book_pdf_cost_control(document_id) values(doc) on conflict do nothing;
 select * into ctl from public.book_pdf_cost_control where document_id=doc;
 select coalesce(sum(actual_usd) filter(where settled),0),coalesce(sum(reserved_usd) filter(where not settled),0),
  count(*) filter(where settled and actual_usd is null) into spent,reserved,unknown_count from public.pdf_batch_request_cost where document_id=doc;
 return jsonb_build_object('allowed',ctl.stop_reason is null and unknown_count=0 and spent+ctl.prior_usd+reserved<ctl.limit_usd,
  'reason',coalesce(ctl.stop_reason,case when unknown_count>0 then 'unknown_usage_cost' when spent+ctl.prior_usd+reserved>=ctl.limit_usd then 'file_budget_exceeded' end),
  'limit_usd',ctl.limit_usd,'spent_usd',spent+ctl.prior_usd,'reserved_usd',reserved);
end $$;

create or replace function public.book_pdf_cost_quality(p_job uuid,p_token uuid,p_unit text,p_status text)
returns void language plpgsql security invoker set search_path='' as $$
declare doc uuid; flags jsonb; checked integer; failed integer; repaired integer;
begin
 select target_id into doc from public.pdf_import_job where id=p_job and kind='bank_book' and status='running'
  and lease_token=p_token and lease_expires_at>now() for update;
 if not found then raise exception 'worker lease lost'; end if;
 if p_unit !~ '^unit-[0-9]+$' or p_status not in ('mapped','repair','failed','passed') then raise exception 'invalid quality signal'; end if;
 insert into public.book_pdf_cost_control(document_id) values(doc) on conflict do nothing;
 perform 1 from public.book_pdf_cost_control where document_id=doc for update;
 select coalesce(quality->p_unit,'{}'::jsonb) into flags from public.book_pdf_cost_control where document_id=doc;
 flags=flags || jsonb_build_object('checked',true,p_status,true);
 update public.book_pdf_cost_control set quality=jsonb_set(quality,array[p_unit],flags),updated_at=now() where document_id=doc;
 select count(*),count(*) filter(where value->>'failed'='true'),count(*) filter(where value->>'repair'='true')
  into checked,failed,repaired from public.book_pdf_cost_control c cross join lateral jsonb_each(c.quality) where c.document_id=doc;
 if checked>=10 and (failed::numeric/checked>=0.3 or repaired::numeric/checked>=0.4) then
  update public.book_pdf_cost_control set stop_reason=coalesce(stop_reason,
   case when failed::numeric/checked>=0.3 then 'quality_failure_rate' else 'quality_repair_rate' end) where document_id=doc;
 end if;
end $$;

create or replace function public.book_pdf_batch_prepare(p_job uuid,p_token uuid,p_requests jsonb)
returns setof public.book_pdf_batch language plpgsql security invoker set search_path='' as $$
declare item jsonb; total integer; import_kind text;
begin
  select kind into import_kind from public.pdf_import_job
    where id=p_job and kind in ('bank_book','bank_questions','bank_explanation')
      and status='running' and lease_token=p_token and lease_expires_at>now() for update;
  if not found then raise exception 'worker lease lost'; end if;
  if jsonb_typeof(p_requests)<>'array' or jsonb_array_length(p_requests) not between 1 and 1000 then raise exception 'invalid requests'; end if;
  if (select count(*) from jsonb_array_elements(p_requests))<>(select count(distinct r->>'key') from jsonb_array_elements(p_requests) r)
    then raise exception 'duplicate call keys'; end if;
  for item in select value from jsonb_array_elements(p_requests) loop
    if coalesce(item->>'key','') !~ '^[a-f0-9]{64}$' or item ? 'content' or item ? 'params'
      then raise exception 'invalid batch identity'; end if;
    if not (
      (import_kind='bank_book' and coalesce(item->>'task','') in ('book.mapSource','book.auditSource','book.enrichMaterial'))
      or (import_kind='bank_questions' and coalesce(item->>'task','') in ('examBank.parseQuestions','examBank.extractExplanations','vocab.enrich'))
      or (import_kind='bank_explanation' and coalesce(item->>'task','') in ('examBank.extractExplanations','vocab.enrich'))
    ) then raise exception 'invalid batch task'; end if;
    select count(*) into total from public.book_pdf_batch b
      where b.job_id=p_job and exists(select 1 from jsonb_array_elements(b.requests) r where r->>'key'=item->>'key');
    if total>=3 then raise exception 'batch request attempt limit'; end if;
    if exists(select 1 from public.book_pdf_batch b where b.job_id=p_job and b.state in ('submitting','submitted')
      and exists(select 1 from jsonb_array_elements(b.requests) r where r->>'key'=item->>'key')) then raise exception 'batch request already active'; end if;
  end loop;
  if import_kind='bank_book' and (jsonb_array_length(p_requests)>10 or exists(select 1 from jsonb_array_elements(p_requests) x where coalesce(x->>'unitKey','') !~ '^unit-[0-9]+$' or coalesce(x->>'maxOutputTokens','') !~ '^[0-9]+$')) then raise exception 'cost-aware worker required'; end if;
  return query insert into public.book_pdf_batch(job_id,state,requests) values(p_job,'submitting',p_requests) returning *;
end $$;

-- Atomic per-document reservation survives job retries and concurrent claims.
-- A rejected/unknown submission never creates free budget by forgetting its row.
create or replace function public.book_pdf_cost_reserve(p_job uuid,p_token uuid,p_batch uuid,p_estimates jsonb,p_protocol text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare doc uuid; ctl public.book_pdf_cost_control; info jsonb; item jsonb; meta jsonb; required numeric=0; price numeric;
begin
 select target_id into doc from public.pdf_import_job where id=p_job and kind='bank_book' and status='running'
  and lease_token=p_token and lease_expires_at>now() for update;
 if not found then raise exception 'worker lease lost'; end if;
 insert into public.book_pdf_cost_control(document_id) values(doc) on conflict do nothing;
 select * into ctl from public.book_pdf_cost_control where document_id=doc for update;
 if coalesce(p_protocol,'') !~ '^[a-f0-9]{64}$' then raise exception 'invalid protocol'; end if;
 if ctl.protocol is not null and ctl.protocol<>p_protocol then
  update public.book_pdf_cost_control set stop_reason=coalesce(stop_reason,'protocol_changed') where document_id=doc;
 end if;
 info=public.book_pdf_cost_summary(p_job,p_token);
 if not (info->>'allowed')::boolean then return info; end if;
 if jsonb_typeof(p_estimates)<>'array' or jsonb_array_length(p_estimates) not between 1 and 10 then raise exception 'invalid estimates'; end if;
 if not exists(select 1 from public.book_pdf_batch where id=p_batch and job_id=p_job and state='submitting'
  and jsonb_array_length(requests)=jsonb_array_length(p_estimates)) then raise exception 'invalid reserved batch'; end if;
 if (select count(distinct e->>'key') from jsonb_array_elements(p_estimates) e)<>jsonb_array_length(p_estimates) then raise exception 'duplicate estimate'; end if;
 for item in select value from jsonb_array_elements(p_estimates) loop
  select r into meta from public.book_pdf_batch b cross join lateral jsonb_array_elements(b.requests) r
   where b.id=p_batch and r->>'key'=item->>'key';
  if meta is null or coalesce(item->>'unitKey','') !~ '^unit-[0-9]+$' or meta->>'unitKey' is distinct from item->>'unitKey'
   or (item->>'inputLimit')::numeric<256 or (item->>'inputLimit')::numeric>1100256
   or (item->>'maxOutputTokens')::numeric not between 1 and 32768
   or meta->>'maxOutputTokens' is distinct from item->>'maxOutputTokens' then raise exception 'invalid cost identity'; end if;
  price=public.pdf_batch_token_cost(meta->>'model',jsonb_build_object('inputTokens',(item->>'inputLimit')::numeric,
    'outputTokens',(item->>'maxOutputTokens')::numeric,'cacheReadTokens',0,'cacheWriteTokens',0));
  if price is null then raise exception 'unknown model price'; end if;
  required=required+ceil(price*1000000)/1000000;
 end loop;
 if exists(select 1 from public.pdf_batch_request_cost where batch_id=p_batch) then raise exception 'batch already reserved'; end if;
 if (info->>'spent_usd')::numeric+(info->>'reserved_usd')::numeric+required>ctl.limit_usd then
  update public.book_pdf_cost_control set stop_reason='file_budget_exceeded' where document_id=doc;
  return info || jsonb_build_object('allowed',false,'reason','file_budget_exceeded','next_usd',required);
 end if;
 insert into public.pdf_batch_request_cost(batch_id,call_key,document_id,unit_key,reserved_usd)
  select p_batch,e->>'key',doc,e->>'unitKey',ceil(public.pdf_batch_token_cost(r->>'model',jsonb_build_object(
    'inputTokens',(e->>'inputLimit')::numeric,'outputTokens',(e->>'maxOutputTokens')::numeric,'cacheReadTokens',0,'cacheWriteTokens',0))*1000000)/1000000
   from jsonb_array_elements(p_estimates) e join public.book_pdf_batch b on b.id=p_batch
   cross join lateral jsonb_array_elements(b.requests) r where r->>'key'=e->>'key';
 update public.book_pdf_cost_control set protocol=coalesce(protocol,p_protocol),updated_at=now() where document_id=doc;
 return public.book_pdf_cost_summary(p_job,p_token) || jsonb_build_object('allowed',true,'next_usd',required);
end $$;

-- One transaction records all delivered usage and settles reservations. Replays
-- use a stable event identity, so reading a checkpoint never creates a new charge.
create or replace function public.pdf_batch_record_usage(p_job uuid,p_token uuid,p_batch uuid,p_environment text)
returns void language plpgsql security invoker set search_path='' as $$
declare batch public.book_pdf_batch; item jsonb; delivery jsonb; doc uuid; price numeric; stamp timestamptz;
begin
 select case when kind='bank_book' then target_id end into doc from public.pdf_import_job
  where id=p_job and status='running' and lease_token=p_token and lease_expires_at>now() for update;
 if not found then raise exception 'worker lease lost'; end if;
 if p_environment not in ('production','development','test') then raise exception 'invalid environment'; end if;
 select * into batch from public.book_pdf_batch where id=p_batch and job_id=p_job and state in ('ended','rejected');
 if not found then raise exception 'batch not settled'; end if;
 if doc is not null then
  insert into public.book_pdf_cost_control(document_id) values(doc) on conflict do nothing;
  perform 1 from public.book_pdf_cost_control where document_id=doc for update;
 end if;
 for item in select value from jsonb_array_elements(batch.requests) loop
  select value->'result',created_at into delivery,stamp from public.pdf_import_checkpoint where job_id=p_job and call_key='batch-result:'||(item->>'key')
   and value->'result'->'execution'->>'batchId'=batch.provider_id;
  if delivery is not null then
   price=public.pdf_batch_token_cost(delivery->'execution'->>'responseModel',delivery->'usage');
   insert into public.cost_usage_event(occurred_at,provider,environment,feature,model,request_id,service_tier,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens)
    values(stamp,'claude',p_environment,item->>'task',delivery->'execution'->>'responseModel',
     'pdf-batch:'||p_batch::text||':'||(item->>'key'),'batch',
     (delivery->'usage'->>'inputTokens')::bigint,(delivery->'usage'->>'outputTokens')::bigint,
     (delivery->'usage'->>'cacheReadTokens')::bigint,(delivery->'usage'->>'cacheWriteTokens')::bigint)
    on conflict(provider,environment,request_id) do nothing;
  elsif batch.state='rejected' or (batch.outcomes ? (item->>'key') and batch.outcomes->>(item->>'key')<>'succeeded') then price=0;
  else raise exception 'missing billed result'; end if;
  insert into public.pdf_batch_request_cost(batch_id,call_key,document_id,unit_key,reserved_usd,actual_usd,settled)
   values(p_batch,item->>'key',doc,item->>'unitKey',coalesce(price,0),price,true)
   on conflict(batch_id,call_key) do update set actual_usd=excluded.actual_usd,settled=true;
  if doc is not null and (price is null or exists(select 1 from public.pdf_batch_request_cost where batch_id=p_batch and call_key=item->>'key' and actual_usd>reserved_usd)) then
   update public.book_pdf_cost_control set stop_reason=coalesce(stop_reason,case when price is null then 'unknown_usage_cost' else 'reservation_overrun' end) where document_id=doc;
  end if;
 end loop;
end $$;

drop function if exists public.cost_usage_summary(timestamptz,timestamptz,text);
create function public.cost_usage_summary(p_start timestamptz,p_end timestamptz,p_environment text)
returns table(provider text,feature text,model text,calls bigint,units numeric,input_tokens numeric,output_tokens numeric,cache_read_tokens numeric,cache_write_tokens numeric,service_tier text)
language sql stable security invoker set search_path='' as $$
 select e.provider,e.feature,e.model,count(*),sum(e.units),sum(e.input_tokens),sum(e.output_tokens),sum(e.cache_read_tokens),sum(e.cache_write_tokens),e.service_tier
 from public.cost_usage_event e where e.occurred_at>=p_start and e.occurred_at<p_end and e.environment=p_environment
 group by e.provider,e.feature,e.model,e.service_tier;
$$;

-- Explicit environment prevents labelling development's history as production.
-- Run SELECT public.pdf_batch_backfill_usage('development') in dev and
-- SELECT public.pdf_batch_backfill_usage('production') in production after this SQL.
create or replace function public.pdf_batch_backfill_usage(p_environment text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_environment not in ('production','development','test') then raise exception 'invalid environment'; end if;
insert into public.cost_usage_event(occurred_at,provider,environment,feature,model,request_id,service_tier,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens)
 select c.created_at,'claude',p_environment,
 r->>'task',c.value->'result'->'execution'->>'responseModel','pdf-batch:'||b.id::text||':'||(r->>'key'),'batch',
 (c.value->'result'->'usage'->>'inputTokens')::bigint,(c.value->'result'->'usage'->>'outputTokens')::bigint,
 (c.value->'result'->'usage'->>'cacheReadTokens')::bigint,(c.value->'result'->'usage'->>'cacheWriteTokens')::bigint
 from public.book_pdf_batch b cross join lateral jsonb_array_elements(b.requests) r
 join public.pdf_import_checkpoint c on c.job_id=b.job_id and c.call_key='batch-result:'||(r->>'key') where c.value ? 'result' and c.value->'result'->'execution'->>'batchId'=b.provider_id
 on conflict(provider,environment,request_id) do nothing;
end $$;
-- Backfill the budget ledger independently of dashboard environment labels.
insert into public.pdf_batch_request_cost(batch_id,call_key,document_id,unit_key,reserved_usd,actual_usd,settled)
 select b.id,r->>'key',case when j.kind='bank_book' then j.target_id end,r->>'unitKey',coalesce(public.pdf_batch_token_cost(c.value->'result'->'execution'->>'responseModel',c.value->'result'->'usage'),0),
 public.pdf_batch_token_cost(c.value->'result'->'execution'->>'responseModel',c.value->'result'->'usage'),true
 from public.book_pdf_batch b join public.pdf_import_job j on j.id=b.job_id cross join lateral jsonb_array_elements(b.requests) r
 join public.pdf_import_checkpoint c on c.job_id=b.job_id and c.call_key='batch-result:'||(r->>'key') where c.value ? 'result' and c.value->'result'->'execution'->>'batchId'=b.provider_id
 on conflict(batch_id,call_key) do nothing;
insert into public.book_pdf_cost_control(document_id,stop_reason)
 select distinct j.target_id,'legacy_review_required' from public.book_pdf_batch b join public.pdf_import_job j on j.id=b.job_id where j.kind='bank_book' on conflict do nothing;
insert into public.book_pdf_cost_control(document_id,prior_usd,stop_reason)
 select j.target_id,coalesce(sum(public.pdf_batch_token_cost(c.value->'execution'->>'responseModel',c.value->'usage')*2),0),'legacy_review_required'
 from public.pdf_import_job j join public.pdf_import_checkpoint c on c.job_id=j.id
 where j.kind='bank_book' and c.value ? 'execution' and coalesce(c.value->'execution'->>'transport','standard')<>'batch'
 group by j.target_id on conflict(document_id) do update set prior_usd=excluded.prior_usd;

revoke all on function public.pdf_batch_token_cost(text,jsonb) from public,anon,authenticated;
revoke all on function public.book_pdf_cost_summary(uuid,uuid) from public,anon,authenticated;
revoke all on function public.book_pdf_cost_quality(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.book_pdf_cost_reserve(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.pdf_batch_record_usage(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.cost_usage_summary(timestamptz,timestamptz,text) from public,anon,authenticated;
revoke all on function public.pdf_batch_backfill_usage(text) from public,anon,authenticated;
grant execute on function public.pdf_batch_token_cost(text,jsonb),public.book_pdf_cost_summary(uuid,uuid),public.book_pdf_cost_quality(uuid,uuid,text,text),
 public.book_pdf_cost_reserve(uuid,uuid,uuid,jsonb,text),public.pdf_batch_record_usage(uuid,uuid,uuid,text),public.pdf_batch_backfill_usage(text),public.cost_usage_summary(timestamptz,timestamptz,text) to service_role;
commit;
