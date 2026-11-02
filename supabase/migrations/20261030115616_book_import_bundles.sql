begin;
create table if not exists public.book_pdf_bundle (
 id uuid primary key default gen_random_uuid(),teacher_id uuid not null,
 request_key uuid not null,files jsonb not null check(jsonb_typeof(files)='array' and jsonb_array_length(files) between 1 and 4),
 limit_usd numeric(18,6) not null default 20 check(limit_usd>0 and limit_usd<=20),
 state text not null default 'preparing' check(state in('preparing','ready')),
 register_token uuid,register_until timestamptz,stop_reason text,created_at timestamptz not null default now(),unique(teacher_id,request_key)
);
create table if not exists public.book_pdf_bundle_file (
 bundle_id uuid not null references public.book_pdf_bundle(id),position integer not null check(position between 0 and 3),
 document_id uuid unique not null references public.book_pdf_document(id),job_id uuid references public.pdf_import_job(id),
 preflight jsonb,phase text not null default 'pilot' check(phase in('pilot','bulk','held')),reason text,
 slot_token uuid,slot_until timestamptz,primary key(bundle_id,position)
);
alter table public.book_pdf_bundle enable row level security;
alter table public.book_pdf_bundle_file enable row level security;
revoke all on public.book_pdf_bundle,public.book_pdf_bundle_file from public,anon,authenticated;
grant all on public.book_pdf_bundle,public.book_pdf_bundle_file to service_role;

create or replace function public.book_pdf_bundle_open(p_teacher uuid,p_key uuid,p_files jsonb,p_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.book_pdf_bundle;
begin
 if jsonb_typeof(p_files)<>'array' or jsonb_array_length(p_files) not between 1 and 4 then raise exception 'invalid bundle files'; end if;
 insert into public.book_pdf_bundle(teacher_id,request_key,files,limit_usd) values(p_teacher,p_key,p_files,jsonb_array_length(p_files)*5) on conflict do nothing;
 select * into b from public.book_pdf_bundle where teacher_id=p_teacher and request_key=p_key for update;
 if b.files is distinct from p_files then raise exception '등록 요청 내용이 바뀌었습니다. 기존 접수 내용을 확인해주세요.'; end if;
 if b.state='preparing' and b.register_until>now() and b.register_token is distinct from p_token then raise exception '묶음을 접수 중입니다. 잠시 후 같은 요청으로 다시 확인해주세요.'; end if;
 if b.state='preparing' then update public.book_pdf_bundle set register_token=p_token,register_until=now()+interval '10 minutes' where id=b.id; end if;
 return jsonb_build_object('id',b.id,'ready',b.state='ready');
end $$;
create or replace function public.book_pdf_bundle_attach(p_bundle uuid,p_token uuid,p_position integer,p_document uuid,p_job uuid default null)
returns void language plpgsql security invoker set search_path='' as $$
declare b public.book_pdf_bundle; old_doc uuid;
begin
 select * into b from public.book_pdf_bundle where id=p_bundle and state='preparing' and register_token=p_token and register_until>now() for update;
 if not found or p_position<0 or p_position>=jsonb_array_length(b.files) then raise exception '묶음 접수 권한이 만료됐습니다.'; end if;
 if not exists(select 1 from public.book_pdf_document where id=p_document and teacher_id=b.teacher_id) then raise exception 'foreign document'; end if;
 if p_job is not null and not exists(select 1 from public.pdf_import_job where id=p_job and target_id=p_document and teacher_id=b.teacher_id and kind='bank_book') then raise exception 'foreign job'; end if;
 select document_id into old_doc from public.book_pdf_bundle_file where bundle_id=b.id and position=p_position;
 if old_doc is not null and old_doc<>p_document then raise exception 'bundle document changed'; end if;
 if exists(select 1 from public.book_pdf_bundle_file where document_id=p_document and (bundle_id<>b.id or position<>p_position)) then raise exception '이미 다른 위치 또는 묶음에 등록된 동일 파일입니다. 기존 자료를 이용해주세요.'; end if;
 insert into public.book_pdf_bundle_file(bundle_id,position,document_id,job_id) values(b.id,p_position,p_document,p_job)
 on conflict(bundle_id,position) do update set job_id=coalesce(excluded.job_id,public.book_pdf_bundle_file.job_id);
end $$;
create or replace function public.book_pdf_bundle_seal(p_bundle uuid,p_token uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare b public.book_pdf_bundle;
begin
 select * into b from public.book_pdf_bundle where id=p_bundle and register_token=p_token and register_until>now() for update;
 if not found then raise exception 'registration lease lost'; end if;
 if (select count(*) from public.book_pdf_bundle_file where bundle_id=b.id)<>jsonb_array_length(b.files) then raise exception '묶음 파일 접수가 끝나지 않았습니다.'; end if;
 update public.book_pdf_bundle set state='ready',register_until=null where id=b.id;
end $$;

create or replace function public.book_pdf_profile_plan(p_job uuid,p_token uuid,p_plan jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare doc uuid; f public.book_pdf_bundle_file;
begin
 select target_id into doc from public.pdf_import_job where id=p_job and kind='bank_book' and status='running' and lease_token=p_token and lease_expires_at>now();
 if not found then raise exception 'worker lease lost'; end if;
 select * into f from public.book_pdf_bundle_file where document_id=doc for update;
 if not found then raise exception 'bundle required'; end if;
 if p_plan->>'version'<>'jugis-two-column-v1' or coalesce(p_plan->>'snapshot_hash','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(p_plan->'pilot_keys')<>'array' or jsonb_array_length(p_plan->'pilot_keys') not between 1 and 6
  or (p_plan->>'unit_count')::int<>(select count(*) from public.book_pdf_unit where document_id=doc)
  or exists(select 1 from jsonb_array_elements_text(p_plan->'pilot_keys') k where not exists(select 1 from public.book_pdf_unit where document_id=doc and unit_key=k)) then raise exception 'invalid profile plan'; end if;
 if f.preflight is not null and f.preflight is distinct from p_plan then
  update public.book_pdf_bundle_file set phase='held',reason='처리 중 형식별 파서·원문 좌표가 변경돼 새 요청을 차단했습니다.' where document_id=doc;
  update public.book_pdf_bundle set stop_reason='처리 중 원문·파서 버전이 바뀌어 묶음의 새 요청을 차단했습니다.' where id=f.bundle_id;
 else update public.book_pdf_bundle_file set preflight=p_plan where document_id=doc; end if;
 select * into f from public.book_pdf_bundle_file where document_id=doc;
 return jsonb_build_object('phase',f.phase,'reason',f.reason,'pilot_keys',f.preflight->'pilot_keys');
end $$;
create or replace function public.book_pdf_bundle_anomaly(p_bundle uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if exists(select issue from public.book_pdf_bundle_file f join public.book_pdf_unit u on u.document_id=f.document_id
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(u.verification->'issues')='array' then u.verification->'issues' else '[]'::jsonb end) issue
  where f.bundle_id=p_bundle and f.preflight is not null and f.preflight->'pilot_keys' ? u.unit_key
    and issue in('invalid_audit_schema','invalid_selective_repair_schema','invalid_combined_repair_contract')
  group by issue having count(distinct f.document_id)>=2) then
  update public.book_pdf_bundle set stop_reason='여러 파일에서 같은 검증 응답 형식 오류가 반복돼 새 요청을 중지했습니다.' where id=p_bundle;
 end if;
end $$;
create or replace function public.book_pdf_profile_expand(p_job uuid,p_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare doc uuid; f public.book_pdf_bundle_file; rate numeric; spent numeric; remaining integer; projection numeric; info jsonb;
begin
 select target_id into doc from public.pdf_import_job where id=p_job and status='running' and kind='bank_book' and lease_token=p_token and lease_expires_at>now();
 if not found then raise exception 'worker lease lost'; end if;
 select * into f from public.book_pdf_bundle_file where document_id=doc for update;
 if f.preflight is null or f.phase<>'pilot' then raise exception 'pilot plan required'; end if;
 if exists(select 1 from jsonb_array_elements_text(f.preflight->'pilot_keys') k where not exists(select 1 from public.book_pdf_unit u where u.document_id=doc and u.unit_key=k
  and u.verification->>'status'='passed' and u.enrichment->>'status'='complete' and u.verified_version=u.version)) then
  update public.book_pdf_bundle_file set phase='held',reason='대표 구간의 원본 대조·풀이·어휘 보완을 모두 통과하지 못했습니다.' where document_id=doc;
  perform public.book_pdf_bundle_anomaly(f.bundle_id);
  return jsonb_build_object('allowed',false,'reason','대표 구간의 미완료 문항을 확인해주세요. 전체 처리로 확대하지 않았습니다.');
 end if;
 select count(*) into remaining from public.book_pdf_unit where document_id=doc and not coalesce(verification->>'status'='passed' and enrichment->>'status'='complete' and verified_version=version,false);
 select max(amount) into rate from(select unit_key,sum(actual_usd) amount from public.pdf_batch_request_cost where document_id=doc and settled and unit_key in(select jsonb_array_elements_text(f.preflight->'pilot_keys')) group by unit_key) x;
 info=public.book_pdf_cost_summary(p_job,p_token);
 spent=(info->>'spent_usd')::numeric;projection=spent+coalesce(rate,0)*remaining*1.25;
 if remaining>0 and (coalesce(rate,0)=0 or projection>(info->>'limit_usd')::numeric) then
  update public.book_pdf_bundle_file set phase='held',reason='대표 구간으로 남은 비용을 확정하지 못했거나 예상 총액이 파일 예산을 넘습니다.' where document_id=doc;
  return jsonb_build_object('allowed',false,'reason','남은 비용 견적을 확인해야 합니다. 파일 예산을 늘리거나 새 요청을 보내지 않았습니다.','projected_usd',projection);
 end if;
 update public.book_pdf_bundle_file set phase='bulk' where document_id=doc;
 return jsonb_build_object('allowed',true,'projected_usd',projection);
end $$;

-- Keep the existing per-file accounting unchanged, then wrap it with an atomic
-- bundle gate. Legacy exam and weekly imports do not acquire a bundle.
do $$ begin
 if to_regprocedure('public.book_pdf_cost_summary_file(uuid,uuid)') is null then alter function public.book_pdf_cost_summary(uuid,uuid) rename to book_pdf_cost_summary_file; end if;
 if to_regprocedure('public.book_pdf_cost_reserve_file(uuid,uuid,uuid,jsonb,text)') is null then alter function public.book_pdf_cost_reserve(uuid,uuid,uuid,jsonb,text) rename to book_pdf_cost_reserve_file; end if;
end $$;
create or replace function public.book_pdf_cost_summary(p_job uuid,p_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare doc uuid; f public.book_pdf_bundle_file; b public.book_pdf_bundle; info jsonb; spent numeric; reserved numeric; pending integer; active integer; reason text; pilot numeric;
begin
 info=public.book_pdf_cost_summary_file(p_job,p_token);
 select target_id into doc from public.pdf_import_job where id=p_job;
 select * into f from public.book_pdf_bundle_file where document_id=doc;
 if not found then return info; end if;
 select * into b from public.book_pdf_bundle where id=f.bundle_id for update;
 select coalesce(sum(c.prior_usd),0) into spent from public.book_pdf_cost_control c join public.book_pdf_bundle_file x on x.document_id=c.document_id where x.bundle_id=b.id;
 select spent+coalesce(sum(c.actual_usd) filter(where c.settled),0),coalesce(sum(c.reserved_usd) filter(where not c.settled),0),count(*) filter(where not c.settled)
  into spent,reserved,pending from public.pdf_batch_request_cost c join public.book_pdf_bundle_file x on x.document_id=c.document_id where x.bundle_id=b.id;
 select count(*) into active from public.book_pdf_bundle_file x where x.bundle_id=b.id and x.document_id<>doc and
  ((x.slot_until>now() and exists(select 1 from public.pdf_import_job j where j.target_id=x.document_id and j.status='running' and j.lease_token=x.slot_token and j.lease_expires_at>now()))
   or exists(select 1 from public.pdf_batch_request_cost c where c.document_id=x.document_id and not c.settled));
 if b.stop_reason is not null then reason='bundle_held';
 elsif b.state<>'ready' then reason='bundle_preparing';
 elsif exists(select 1 from public.book_pdf_bundle_file x join public.book_pdf_document d on d.id=x.document_id where x.bundle_id=b.id and x.preflight is null and d.status<>'published'
  and exists(select 1 from public.pdf_import_job j where j.id=x.job_id and j.status in('queued','running','waiting_batch'))) then reason='bundle_preparing';
 elsif f.preflight is null then reason='profile_preflight_required';
 elsif f.phase='held' then reason='profile_held';
 elsif exists(select 1 from public.pdf_batch_request_cost c join public.book_pdf_bundle_file x on x.document_id=c.document_id where x.bundle_id=b.id and c.settled and c.actual_usd is null) then reason='unknown_usage_cost';
 elsif spent+reserved>=b.limit_usd then reason='bundle_budget_exceeded';
 elsif active>=2 or pending>=8 then reason='bundle_busy'; end if;
 if reason is null and (info->>'allowed')::boolean then update public.book_pdf_bundle_file set slot_token=p_token,slot_until=now()+interval '10 minutes' where document_id=doc; end if;
 select coalesce(sum(case when settled then actual_usd else reserved_usd end),0) into pilot from public.pdf_batch_request_cost where document_id=doc and unit_key in(select jsonb_array_elements_text(f.preflight->'pilot_keys'));
 if reason is null and f.phase='pilot' and pilot>=.5 then reason='pilot_budget_exceeded'; end if;
 return info || jsonb_build_object('allowed',(info->>'allowed')::boolean and reason is null,'reason',coalesce(info->>'reason',reason),
  'bundle_limit_usd',b.limit_usd,'bundle_spent_usd',spent,'bundle_reserved_usd',reserved,'pilot_usd',pilot,'phase',f.phase);
end $$;
create or replace function public.book_pdf_cost_reserve(p_job uuid,p_token uuid,p_batch uuid,p_estimates jsonb,p_protocol text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare doc uuid; f public.book_pdf_bundle_file; info jsonb; price numeric=0; item jsonb; model text; live integer;
begin
 select target_id into doc from public.pdf_import_job where id=p_job;
 select * into f from public.book_pdf_bundle_file where document_id=doc;
 if not found then return public.book_pdf_cost_reserve_file(p_job,p_token,p_batch,p_estimates,p_protocol); end if;
 perform 1 from public.book_pdf_bundle where id=f.bundle_id for update;
 info=public.book_pdf_cost_summary(p_job,p_token);
 if not (info->>'allowed')::boolean then return info; end if;
 if jsonb_typeof(p_estimates)<>'array' or jsonb_array_length(p_estimates) not between 1 and 4 then raise exception 'bundle window is four per file'; end if;
 for item in select value from jsonb_array_elements(p_estimates) loop
  if f.phase='pilot' and not (f.preflight->'pilot_keys' ? (item->>'unitKey')) then raise exception 'request outside pilot'; end if;
  select r->>'model' into model from public.book_pdf_batch b cross join lateral jsonb_array_elements(b.requests) r where b.id=p_batch and r->>'key'=item->>'key';
  price=price+public.pdf_batch_token_cost(model,jsonb_build_object('inputTokens',(item->>'inputLimit')::numeric,'outputTokens',(item->>'maxOutputTokens')::numeric,'cacheReadTokens',0,'cacheWriteTokens',0));
 end loop;
 if price is null or price<=0 then raise exception 'unknown bundle request cost'; end if;
 select count(*) into live from public.pdf_batch_request_cost c join public.book_pdf_bundle_file x on x.document_id=c.document_id where x.bundle_id=f.bundle_id and not c.settled;
 if live+jsonb_array_length(p_estimates)>8 then return info || jsonb_build_object('allowed',false,'reason','bundle_busy'); end if;
 if (info->>'bundle_spent_usd')::numeric+(info->>'bundle_reserved_usd')::numeric+price>(info->>'bundle_limit_usd')::numeric then return info || jsonb_build_object('allowed',false,'reason','bundle_budget_exceeded'); end if;
 if f.phase='pilot' and (info->>'pilot_usd')::numeric+price>.5 then return info || jsonb_build_object('allowed',false,'reason','pilot_budget_exceeded'); end if;
 return public.book_pdf_cost_reserve_file(p_job,p_token,p_batch,p_estimates,p_protocol);
end $$;

create or replace function public.book_pdf_bundle_read(p_teacher uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(v order by v->>'created_at' desc),'[]'::jsonb) from (
 select jsonb_build_object('id',b.id,'state',b.state,'created_at',b.created_at,'limit_usd',b.limit_usd,'stop_reason',b.stop_reason,
  'files',coalesce((select jsonb_agg(jsonb_build_object('document_id',d.id,'title',d.title,'phase',x.phase,'reason',x.reason,
   'job_id',j.id,'status',case when d.status='published' then 'published' else coalesce(j.status,'queued') end,'error',j.error,
   'unit_count',jsonb_array_length(d.manifest->'units'),'question_count',d.manifest->'question_count',
   'done_units',(select count(*) from public.book_pdf_unit u where u.document_id=d.id and u.verification->>'status'='passed' and u.enrichment->>'status'='complete' and u.verified_version=u.version),
   'spent_usd',coalesce(c.prior_usd,0)+(select coalesce(sum(actual_usd) filter(where settled),0) from public.pdf_batch_request_cost where document_id=d.id),
   'reserved_usd',(select coalesce(sum(reserved_usd) filter(where not settled),0) from public.pdf_batch_request_cost where document_id=d.id)) order by x.position)
   from public.book_pdf_bundle_file x join public.book_pdf_document d on d.id=x.document_id left join public.pdf_import_job j on j.id=x.job_id
    left join public.book_pdf_cost_control c on c.document_id=d.id where x.bundle_id=b.id),'[]'::jsonb)) v
 from public.book_pdf_bundle b where b.teacher_id=p_teacher order by b.created_at desc limit 20) rows;
$$;
revoke all on function public.book_pdf_bundle_read(uuid) from public,anon,authenticated;
grant execute on function public.book_pdf_bundle_read(uuid) to service_role;
create or replace function public.book_pdf_bundle_job(p_job uuid,p_token uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('bookProfile','jugis-two-column-v1','bundleId',f.bundle_id)
 from public.book_pdf_bundle_file f join public.pdf_import_job j on j.id=f.job_id
 where j.id=p_job and j.kind='bank_book' and j.status='running' and j.lease_token=p_token and j.lease_expires_at>now();
$$;
revoke all on function public.book_pdf_bundle_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.book_pdf_bundle_job(uuid,uuid) to service_role;
revoke all on function public.book_pdf_bundle_anomaly(uuid) from public,anon,authenticated;
grant execute on function public.book_pdf_bundle_anomaly(uuid) to service_role;

-- Capacity deferrals are proven unsent, so they must not consume the provider's
-- three-submission retry budget. All uncertain submissions still count.
do $$ declare definition text; begin
 definition=pg_get_functiondef('public.book_pdf_batch_prepare(uuid,uuid,jsonb)'::regprocedure);
 if position('not_sent__' in definition)=0 then
  definition=replace(definition,'where b.job_id=p_job and exists(',
   'where b.job_id=p_job and not coalesce((b.state=''rejected'' and b.outcomes->>''__not_sent__''=''deferred''),false) and exists(');
  execute definition;
 end if;
end $$;

revoke all on function public.book_pdf_bundle_open(uuid,uuid,jsonb,uuid),public.book_pdf_bundle_attach(uuid,uuid,integer,uuid,uuid),public.book_pdf_bundle_seal(uuid,uuid),
 public.book_pdf_profile_plan(uuid,uuid,jsonb),public.book_pdf_profile_expand(uuid,uuid),public.book_pdf_cost_summary(uuid,uuid),public.book_pdf_cost_reserve(uuid,uuid,uuid,jsonb,text),
 public.book_pdf_cost_summary_file(uuid,uuid),public.book_pdf_cost_reserve_file(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.book_pdf_bundle_open(uuid,uuid,jsonb,uuid),public.book_pdf_bundle_attach(uuid,uuid,integer,uuid,uuid),public.book_pdf_bundle_seal(uuid,uuid),
 public.book_pdf_profile_plan(uuid,uuid,jsonb),public.book_pdf_profile_expand(uuid,uuid),public.book_pdf_cost_summary(uuid,uuid),public.book_pdf_cost_reserve(uuid,uuid,uuid,jsonb,text),
 public.book_pdf_cost_summary_file(uuid,uuid),public.book_pdf_cost_reserve_file(uuid,uuid,uuid,jsonb,text) to service_role;
commit;
