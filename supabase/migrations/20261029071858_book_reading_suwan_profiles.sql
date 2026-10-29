-- Enable locally verified reading/Suwan layouts; preserve existing content and proofs.
begin;
alter table public.book_pdf_document drop constraint if exists book_pdf_catalog_volume;
alter table public.book_pdf_document add constraint book_pdf_catalog_volume check(volume in ('full','upper','lower','type','practical'));
alter table public.exam_bank drop constraint if exists exam_bank_catalog_volume;
alter table public.exam_bank add constraint exam_bank_catalog_volume check(book_volume in ('full','upper','lower','type','practical'));
create or replace function public.book_pdf_catalog_title(p_code text,p_year integer,p_volume text)
returns text language sql immutable security invoker set search_path='' as $$
  select case when p_year is null then '' else p_year::text||'학년도 ' end ||
    case p_code when 'suteuk_english' then '수능특강 영어' when 'suteuk_reading' then '수능특강 영어독해연습' when 'suwan_english' then '수능완성 영어' end ||
    case p_volume when 'upper' then ' · 상' when 'lower' then ' · 하' when 'type' then ' · 유형편' when 'practical' then ' · 실전편' else '' end;
$$;

create or replace function public.book_pdf_reserve(p_teacher uuid,p_hash text,p_code text,p_year integer,p_volume text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.book_pdf_document;
begin
  if p_hash!~'^[a-f0-9]{64}$' or p_hash is null or p_teacher is null or (p_code is null or p_code not in ('suteuk_english','suteuk_reading','suwan_english'))
    or p_year is null or p_year not between 1900 and 2200 or p_volume is null or p_volume not in ('full','upper','lower','type','practical') or (p_code='suwan_english' and p_volume in ('upper','lower')) or (p_code<>'suwan_english' and p_volume in ('type','practical')) then raise exception 'invalid book registration'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_teacher::text||':'||p_hash,0));
  select * into d from public.book_pdf_document where teacher_id=p_teacher and source_sha256=p_hash order by created_at,id limit 1;
  if found then return to_jsonb(d)||jsonb_build_object('reused',true); end if;
  insert into public.book_pdf_document(teacher_id,title,academic_year,book_code,volume,source_sha256)
    values(p_teacher,public.book_pdf_catalog_title(p_code,p_year,p_volume),p_year,p_code,p_volume,p_hash) returning * into d;
  return to_jsonb(d)||jsonb_build_object('reused',false);
end $$;

create or replace function public.book_pdf_classify(p_id uuid,p_teacher uuid,p_revision integer,p_code text,p_year integer,p_volume text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare d public.book_pdf_document; correcting boolean;
begin
  select * into d from public.book_pdf_document where id=p_id and teacher_id=p_teacher for update;
  if not found or d.revision is distinct from p_revision then return false; end if;
  if p_code is null or p_code not in ('suteuk_english','suteuk_reading','suwan_english') or p_year is null or p_year not between 1900 and 2200
    or p_volume is null or p_volume not in ('full','upper','lower','type','practical') or (p_code='suwan_english' and p_volume in ('upper','lower')) or (p_code<>'suwan_english' and p_volume in ('type','practical')) then raise exception 'invalid book classification'; end if;
  if exists(select 1 from public.pdf_import_job where target_id=d.id and teacher_id=p_teacher and status in ('queued','running','waiting_batch'))
    then raise exception '처리 중인 자료는 분류를 변경할 수 없습니다.' using errcode='55000'; end if;
  select exists(select 1 from public.pdf_import_job where target_id=d.id and teacher_id=p_teacher and status='failed'
    and result->>'metadata_conflict'='true') into correcting;
  if jsonb_array_length(coalesce(d.manifest->'printed_years','[]'::jsonb))=1 and (d.manifest->'printed_years'->>0)::integer<>p_year then
    raise exception '선택한 학년도와 PDF에 인쇄된 학년도가 다릅니다.'; end if;
  if d.book_code is not null and d.book_code is distinct from p_code and (d.manifest->>'question_count')::integer>0 then
    raise exception '추출된 교재의 종류는 변경할 수 없습니다. 학년도·분권만 수정할 수 있습니다.'; end if;
  update public.book_pdf_document set book_code=p_code,academic_year=p_year,volume=p_volume,
    title=public.book_pdf_catalog_title(p_code,p_year,p_volume),metadata_reviewed=true,revision=revision+1,
    status=case when correcting then 'processing' else status end,
    manifest=case when correcting then manifest-'classification_error' else manifest end where id=d.id;
  if correcting then
    update public.pdf_import_job set result=null,error='분류를 수정했습니다. 같은 작업을 재실행할 수 있습니다.'
      where target_id=d.id and teacher_id=p_teacher and status='failed' and result->>'metadata_conflict'='true';
  end if;
  return true;
end $$;
revoke all on function public.book_pdf_catalog_title(text,integer,text) from public,anon,authenticated;
revoke all on function public.book_pdf_sync_catalog() from public,anon,authenticated;
revoke all on function public.book_pdf_reserve(uuid,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.book_pdf_classify(uuid,uuid,integer,text,integer,text) from public,anon,authenticated;
grant execute on function public.book_pdf_catalog_title(text,integer,text),public.book_pdf_sync_catalog(),
  public.book_pdf_reserve(uuid,text,text,integer,text),public.book_pdf_classify(uuid,uuid,integer,text,integer,text) to service_role;
commit;
