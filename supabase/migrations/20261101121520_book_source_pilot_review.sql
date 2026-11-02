-- Passive gates only: does not resume jobs, alter budgets or rewrite responses.
begin;
alter table public.book_pdf_bundle_file drop constraint if exists book_pdf_bundle_file_phase_check;
alter table public.book_pdf_bundle_file add constraint book_pdf_bundle_file_phase_check check(phase in('pilot','pilot_review','bulk','held'));
alter table public.book_pdf_bundle_file add column if not exists pilot_review jsonb;
alter table public.book_pdf_bundle_file add column if not exists pilot_approved_hash text;

create or replace function public.book_pdf_known_source_revision(p_pdf text,p_source text)
returns text language sql immutable security invoker set search_path='' as $$
 select case when (p_pdf='e63ca425787882bcf77d60499e0d94ebd0daa195ce4f443f95de35623608606a' and p_source='7836115d29a2305659a060aef4e8ea1245cab08966bca192794b133a610e9de2')
 or (p_pdf='ec8b7227b1244680dae9ccc65353694eb8440b7385dc6ae68a1b6c953042f45c' and p_source='7b5ef8399febd6e609b86a21b5144c0ac9b479d7eed6e30da9d01fd92e4c1b9c') then 'source-review-20261101-v1' end;
$$;
create or replace function public.book_pdf_pilot_hash(p_doc uuid)
returns text language sql stable security invoker set search_path='' as $$
 select md5(jsonb_build_object('plan',f.preflight,'pdf',d.source_sha256,'limit',c.limit_usd,'bundle_limit',b.limit_usd,
 'units',(select jsonb_agg(jsonb_build_array(u.unit_key,u.version,u.verified_version,u.verification,u.enrichment) order by u.unit_key)
 from public.book_pdf_unit u where u.document_id=p_doc and f.preflight->'pilot_keys' ? u.unit_key))::text)
 from public.book_pdf_bundle_file f join public.book_pdf_document d on d.id=f.document_id
 join public.book_pdf_bundle b on b.id=f.bundle_id join public.book_pdf_cost_control c on c.document_id=f.document_id where f.document_id=p_doc;
$$;
create or replace function public.book_pdf_pilot_ready(p_doc uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select f.preflight is not null and jsonb_array_length(f.preflight->'pilot_keys') between 1 and 6 and not exists(
 select 1 from jsonb_array_elements_text(f.preflight->'pilot_keys') k where not exists(select 1 from public.book_pdf_unit u where u.document_id=p_doc and u.unit_key=k
 and u.verification->>'status'='passed' and u.enrichment->>'status'='complete' and u.verified_version=u.version
 and (public.book_pdf_known_source_revision(u.verification->>'pdf_hash',u.verification->>'source_hash') is null
 or u.verification->>'source_revision'=public.book_pdf_known_source_revision(u.verification->>'pdf_hash',u.verification->>'source_hash'))))
 from public.book_pdf_bundle_file f where f.document_id=p_doc;
$$;
create or replace function public.book_pdf_profile_pause(p_job uuid,p_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare doc uuid; f public.book_pdf_bundle_file; review jsonb; spent numeric; reserved numeric; cap numeric; remaining integer;
begin
 select target_id into doc from public.pdf_import_job where id=p_job and kind='bank_book' and status='running' and lease_token=p_token and lease_expires_at>now() for update;
 if not found then raise exception 'worker lease lost'; end if;
 -- A fully cached pilot may never have reserved a request. Initialize the
 -- normal cost ledger before binding the review snapshot to its existing cap.
 perform public.book_pdf_cost_summary(p_job,p_token);
 select * into f from public.book_pdf_bundle_file where document_id=doc for update;
 if f.phase='pilot_review' then return jsonb_build_object('ready',true,'review',f.pilot_review); end if;
 if f.phase<>'pilot' or f.preflight is null then raise exception 'pilot plan required'; end if;
 if not coalesce(public.book_pdf_pilot_ready(doc),false) then
  update public.book_pdf_bundle_file set phase='held',reason='대표 구간의 원본 대조·풀이·어휘 보완을 모두 통과하지 못했습니다.' where document_id=doc;
  return jsonb_build_object('ready',false,'reason','대표 구간에 미완료 또는 재검증 대상이 있어 전체 처리를 보류했습니다.');
 end if;
 select limit_usd,prior_usd into cap,spent from public.book_pdf_cost_control where document_id=doc;
 select spent+coalesce(sum(actual_usd) filter(where settled),0),coalesce(sum(reserved_usd) filter(where not settled),0) into spent,reserved from public.pdf_batch_request_cost where document_id=doc;
 select count(*) into remaining from public.book_pdf_unit where document_id=doc and not coalesce(verification->>'status'='passed' and enrichment->>'status'='complete' and verified_version=version,false);
 review=jsonb_build_object('snapshot',public.book_pdf_pilot_hash(doc),'pilot_keys',f.preflight->'pilot_keys','completed_units',jsonb_array_length(f.preflight->'pilot_keys'),
 'remaining_units',remaining,'spent_usd',spent,'reserved_usd',reserved,'limit_usd',cap,'labels',f.preflight->'pilot_labels','estimate_status','per_request_budget_enforced','created_at',now());
 update public.book_pdf_bundle_file set phase='pilot_review',reason='대표 구간 검증 완료 · 전체 처리 승인 대기',pilot_review=review,pilot_approved_hash=null where document_id=doc;
 return jsonb_build_object('ready',true,'review',review);
end $$;
create or replace function public.book_pdf_pilot_review_info(p_doc uuid,p_teacher uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('phase',f.phase,'review',f.pilot_review,'snapshot_current',public.book_pdf_pilot_hash(p_doc),'approved',f.pilot_approved_hash is not null)
 from public.book_pdf_bundle_file f join public.book_pdf_document d on d.id=f.document_id where f.document_id=p_doc and d.teacher_id=p_teacher;
$$;
create or replace function public.book_pdf_pilot_approve(p_doc uuid,p_teacher uuid,p_snapshot text,p_confirm boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f public.book_pdf_bundle_file; j public.pdf_import_job; info jsonb;
begin
 select * into j from public.pdf_import_job where target_id=p_doc and kind='bank_book' and teacher_id=p_teacher order by created_at desc limit 1 for update;
 if not found or j.status<>'failed' or coalesce(j.payload->>'recoveryExcluded','false')='true' then raise exception 'stopped owned job required'; end if;
 select * into f from public.book_pdf_bundle_file where document_id=p_doc for update;
 if p_confirm is distinct from true or f.phase<>'pilot_review' or f.pilot_review->>'snapshot' is distinct from p_snapshot
 or p_snapshot is distinct from public.book_pdf_pilot_hash(p_doc) or not coalesce(public.book_pdf_pilot_ready(p_doc),false) then raise exception 'pilot review snapshot changed'; end if;
 if exists(select 1 from public.pdf_batch_request_cost where document_id=p_doc and (not settled or actual_usd is null)) then raise exception 'unsettled usage requires review'; end if;
 if exists(select 1 from public.book_pdf_cost_control c where c.document_id=p_doc and c.prior_usd+(select coalesce(sum(actual_usd),0) from public.pdf_batch_request_cost where document_id=p_doc)>=c.limit_usd) then raise exception 'file budget exhausted'; end if;
 update public.book_pdf_bundle_file set pilot_approved_hash=p_snapshot,phase='bulk',reason=null where document_id=p_doc;
 update public.pdf_import_job set result=coalesce(result,'{}'::jsonb)||jsonb_build_object('pilot_review_approved',true),stage='전체 처리 승인 완료 · 재개 대기' where id=j.id;
 return jsonb_build_object('approved',true,'resumed',false);
end $$;

create or replace function public.book_pdf_review_transition_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='book_pdf_bundle_file' then
  if new.phase='bulk' and (new.pilot_approved_hash is null or new.pilot_approved_hash is distinct from public.book_pdf_pilot_hash(new.document_id)) then raise exception 'explicit pilot approval required'; end if;
 elsif tg_table_name='book_pdf_document' then
  if new.status='published' and exists(select 1 from public.book_pdf_unit u where u.document_id=new.id
   and public.book_pdf_known_source_revision(u.verification->>'pdf_hash',u.verification->>'source_hash') is not null
   and u.verification->>'source_revision' is distinct from public.book_pdf_known_source_revision(u.verification->>'pdf_hash',u.verification->>'source_hash')) then raise exception 'known cached source requires fresh image audit'; end if;
  if new.status='published' and exists(select 1 from public.book_pdf_bundle_file f where f.document_id=new.id
   and (f.phase<>'bulk' or f.pilot_approved_hash is null or f.pilot_approved_hash is distinct from public.book_pdf_pilot_hash(new.id))) then raise exception 'explicit pilot approval required'; end if;
 else
  if new.kind='bank_book' and new.status in('queued','running','waiting_batch') and (coalesce(new.payload->>'recoveryExcluded','false')='true'
   or exists(select 1 from public.pdf_import_job j where j.target_id=new.target_id and j.kind='bank_book' and j.payload->>'recoveryExcluded'='true')) then raise exception 'registered textbook excluded from recovery'; end if;
 end if;
 return new;
end $$;
drop trigger if exists book_pdf_review_transition on public.book_pdf_bundle_file;
create trigger book_pdf_review_transition before update of phase on public.book_pdf_bundle_file for each row execute function public.book_pdf_review_transition_guard();
drop trigger if exists book_pdf_known_source_publish on public.book_pdf_document;
create trigger book_pdf_known_source_publish before update of status on public.book_pdf_document for each row execute function public.book_pdf_review_transition_guard();
drop trigger if exists book_pdf_recovery_exclusion on public.pdf_import_job;
create trigger book_pdf_recovery_exclusion before insert or update of status on public.pdf_import_job for each row execute function public.book_pdf_review_transition_guard();

do $$ begin
 if to_regprocedure('public.book_pdf_cost_summary_pre_pilot_review(uuid,uuid)') is null then alter function public.book_pdf_cost_summary(uuid,uuid) rename to book_pdf_cost_summary_pre_pilot_review; end if;
end $$;
create or replace function public.book_pdf_cost_summary(p_job uuid,p_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare info jsonb; f public.book_pdf_bundle_file; doc uuid;
begin
 info=public.book_pdf_cost_summary_pre_pilot_review(p_job,p_token);
 select target_id into doc from public.pdf_import_job where id=p_job;
 select * into f from public.book_pdf_bundle_file where document_id=doc;
 if found and (f.phase='pilot_review' or (f.phase='bulk' and f.pilot_approved_hash is distinct from public.book_pdf_pilot_hash(doc))) then
  return info||jsonb_build_object('allowed',false,'reason','pilot_review_required');
 end if;
 return info;
end $$;
revoke all on function public.book_pdf_known_source_revision(text,text),public.book_pdf_pilot_hash(uuid),public.book_pdf_pilot_ready(uuid),public.book_pdf_profile_pause(uuid,uuid),public.book_pdf_pilot_review_info(uuid,uuid),public.book_pdf_pilot_approve(uuid,uuid,text,boolean),public.book_pdf_review_transition_guard(),public.book_pdf_cost_summary(uuid,uuid),public.book_pdf_cost_summary_pre_pilot_review(uuid,uuid) from public,anon,authenticated;
grant execute on function public.book_pdf_known_source_revision(text,text),public.book_pdf_pilot_hash(uuid),public.book_pdf_pilot_ready(uuid),public.book_pdf_profile_pause(uuid,uuid),public.book_pdf_pilot_review_info(uuid,uuid),public.book_pdf_pilot_approve(uuid,uuid,text,boolean),public.book_pdf_review_transition_guard(),public.book_pdf_cost_summary(uuid,uuid),public.book_pdf_cost_summary_pre_pilot_review(uuid,uuid) to service_role;
commit;
