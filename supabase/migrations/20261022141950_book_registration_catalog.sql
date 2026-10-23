-- Metadata only: never dispatch jobs, replace questions, or change verification/checkpoints.
begin;
alter table public.book_pdf_document add column if not exists book_code text;
alter table public.book_pdf_document add column if not exists volume text;
alter table public.exam_bank add column if not exists book_code text;
alter table public.exam_bank add column if not exists book_volume text;
alter table public.book_pdf_document drop constraint if exists book_pdf_catalog_code;
alter table public.book_pdf_document add constraint book_pdf_catalog_code check(book_code in ('suteuk_english','suteuk_reading','suwan_english'));
alter table public.book_pdf_document drop constraint if exists book_pdf_catalog_volume;
alter table public.book_pdf_document add constraint book_pdf_catalog_volume check(volume in ('full','upper','lower'));
alter table public.exam_bank drop constraint if exists exam_bank_catalog_code;
alter table public.exam_bank add constraint exam_bank_catalog_code check(book_code is null or (material_kind='textbook' and book_code in ('suteuk_english','suteuk_reading','suwan_english')));
alter table public.exam_bank drop constraint if exists exam_bank_catalog_volume;
alter table public.exam_bank add constraint exam_bank_catalog_volume check(book_volume in ('full','upper','lower'));
create index if not exists book_pdf_document_source_lookup on public.book_pdf_document(teacher_id,source_sha256) where source_sha256 is not null;
create or replace view public.book_pdf_progress with (security_invoker=true) as
  select document_id,count(*) filter(where verified_version=version and verification->>'status'='passed'
    and validation->'errors'='[]'::jsonb)::integer as completed
  from public.book_pdf_unit group by document_id;
revoke all on public.book_pdf_progress from public,anon;
grant select on public.book_pdf_progress to authenticated,service_role;

create or replace function public.book_pdf_catalog_title(p_code text,p_year integer,p_volume text)
returns text language sql immutable security invoker set search_path='' as $$
  select case when p_year is null then '' else p_year::text||'학년도 ' end ||
    case p_code when 'suteuk_english' then '수능특강 영어' when 'suteuk_reading' then '수능특강 영어독해연습' when 'suwan_english' then '수능완성 영어' end ||
    case p_volume when 'upper' then ' · 상' when 'lower' then ' · 하' else '' end;
$$;

-- Also runs after publication links the bank, so existing publish proof/RPCs stay intact.
create or replace function public.book_pdf_sync_catalog()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.exam_bank_id is not null and new.book_code is not null then
    update public.exam_bank set title=new.title,exam_year=new.academic_year,book_code=new.book_code,book_volume=new.volume
      where id=new.exam_bank_id and teacher_id=new.teacher_id and material_kind='textbook';
    update public.vocab_collection set title=new.title||' 어휘',year_from=new.academic_year,year_to=new.academic_year
      where source_document_id=new.id and teacher_id=new.teacher_id;
    update public.vocab_collection_item i set sources=(select coalesce(jsonb_agg(
      case when s->>'source'='교재' and s->>'source_title' in (old.title,new.title)
        then s||jsonb_build_object('source_title',new.title,'year',new.academic_year) else s end order by n),'[]'::jsonb)
      from jsonb_array_elements(i.sources) with ordinality x(s,n))
      where i.collection_id in (select id from public.vocab_collection where source_document_id=new.id and teacher_id=new.teacher_id);
  end if;
  return new;
end $$;
drop trigger if exists book_pdf_sync_catalog on public.book_pdf_document;
create trigger book_pdf_sync_catalog after update of title,academic_year,book_code,volume,exam_bank_id on public.book_pdf_document
  for each row execute function public.book_pdf_sync_catalog();

-- Infer only the unambiguous existing English title. Unknown historical titles remain unclassified.
update public.book_pdf_document set book_code='suteuk_english',
  volume=case when title~'[(（]상[)）]' then 'upper' when title~'[(（]하[)）]' then 'lower' else volume end
  where book_code is null and title~'수능특강.*영어' and title!~'독해|작문|듣기';
update public.book_pdf_document set title=public.book_pdf_catalog_title(book_code,academic_year,volume)
  where book_code is not null and title is distinct from public.book_pdf_catalog_title(book_code,academic_year,volume);

-- A teacher/file lock prevents two tabs from reserving and billing the same PDF twice.
create or replace function public.book_pdf_reserve(p_teacher uuid,p_hash text,p_code text,p_year integer,p_volume text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.book_pdf_document;
begin
  if p_hash!~'^[a-f0-9]{64}$' or p_hash is null or p_teacher is null or p_code is distinct from 'suteuk_english'
    or p_year is null or p_year not between 1900 and 2200 or p_volume is null or p_volume not in ('full','upper','lower') then raise exception 'invalid book registration'; end if;
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
    or p_volume is null or p_volume not in ('full','upper','lower') then raise exception 'invalid book classification'; end if;
  if exists(select 1 from public.pdf_import_job where target_id=d.id and teacher_id=p_teacher and status in ('queued','running','waiting_batch'))
    then raise exception '처리 중인 자료는 분류를 변경할 수 없습니다.' using errcode='55000'; end if;
  select exists(select 1 from public.pdf_import_job where target_id=d.id and teacher_id=p_teacher and status='failed'
    and result->>'metadata_conflict'='true') into correcting;
  if correcting and p_code<>'suteuk_english' then raise exception 'PDF 형식 확인 전인 교재로 작업을 재개할 수 없습니다.'; end if;
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
