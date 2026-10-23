-- EduNote textbook setup bundle. Apply the whole file in each database SQL Editor.
-- Requires the existing PDF worker and exam-bank schema.
-- Originals are retained in supabase/migrations; this file is a convenience bundle.


-- Source migration: 20261015114535_book_pdf_review.sql
-- Apply manually to BOTH databases before enabling BOOK_PDF_IMPORT_ENABLED.
begin;
alter table public.pdf_import_job drop constraint if exists pdf_import_job_kind_check;
alter table public.pdf_import_job add constraint pdf_import_job_kind_check
  check (kind in ('bank_questions','bank_explanation','week_answers','bank_book'));

alter table public.exam_bank add column if not exists material_kind text not null default 'past_exam';
alter table public.exam_bank drop constraint if exists exam_bank_material_kind_check;
alter table public.exam_bank add constraint exam_bank_material_kind_check check (material_kind in ('past_exam','textbook'));
alter table public.exam_bank alter column exam_year drop not null;
alter table public.exam_bank alter column exam_month drop not null;
alter table public.exam_bank alter column grade drop not null;
alter table public.exam_bank alter column form_type drop not null;
alter table public.exam_bank drop constraint if exists exam_bank_past_exam_metadata;
alter table public.exam_bank add constraint exam_bank_past_exam_metadata check
  (material_kind='textbook' or (exam_year is not null and exam_month is not null and grade is not null and form_type is not null));

create table if not exists public.book_pdf_document (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teacher(id) on delete cascade,
  title text not null,
  academic_year integer check (academic_year between 1900 and 2200),
  metadata_reviewed boolean not null default false,
  revision integer not null default 1,
  status text not null default 'processing' check (status in ('processing','review','published')),
  source_path text,
  source_sha256 text,
  manifest jsonb,
  exam_bank_id uuid unique references public.exam_bank(id) on delete cascade,
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists book_pdf_owner_created on public.book_pdf_document(teacher_id,created_at desc);
create table if not exists public.book_pdf_unit (
  document_id uuid not null references public.book_pdf_document(id) on delete cascade,
  unit_key text not null,
  unit_order integer not null,
  manifest jsonb not null,
  extraction jsonb,
  validation jsonb not null default '{"errors":["추출 대기"],"warnings":[],"english_coverage":0,"translation_coverage":0}'::jsonb,
  version integer not null default 1,
  reviewed_version integer,
  reviewed_at timestamptz,
  primary key(document_id,unit_key),
  unique(document_id,unit_order)
);
alter table public.book_pdf_document enable row level security;
alter table public.book_pdf_unit enable row level security;
revoke all on public.book_pdf_document,public.book_pdf_unit from public,anon,authenticated;
grant select on public.book_pdf_document,public.book_pdf_unit to authenticated;
grant all on public.book_pdf_document,public.book_pdf_unit to service_role;
drop policy if exists book_pdf_document_owner_read on public.book_pdf_document;
create policy book_pdf_document_owner_read on public.book_pdf_document for select to authenticated
  using (teacher_id in (select id from public.teacher where auth_id=(select auth.uid())));
drop policy if exists book_pdf_unit_owner_read on public.book_pdf_unit;
create policy book_pdf_unit_owner_read on public.book_pdf_unit for select to authenticated
  using (document_id in (select id from public.book_pdf_document where teacher_id in
    (select id from public.teacher where auth_id=(select auth.uid()))));

alter table public.exam_bank_question add column if not exists source_key text;
alter table public.exam_bank_question add column if not exists source_label text;
alter table public.exam_bank_question add column if not exists source_group_key text;
alter table public.exam_bank_question add column if not exists source_pages integer[] not null default '{}';
alter table public.exam_bank_question add column if not exists source_document_id uuid references public.book_pdf_document(id) on delete set null;
create unique index if not exists exam_bank_source_key on public.exam_bank_question(exam_bank_id,source_key) where source_key is not null;
create index if not exists exam_bank_source_document on public.exam_bank_question(source_document_id) where source_document_id is not null;
alter table public.vocab_collection add column if not exists source_document_id uuid unique references public.book_pdf_document(id) on delete cascade;
alter table public.vocab_collection alter column grade drop not null;
alter table public.vocab_collection alter column year_from drop not null;
alter table public.vocab_collection alter column year_to drop not null;

-- Publication uses an empty search_path. The existing counter trigger must also
-- qualify its table rather than inherit the caller's path.
create or replace function public.exam_bank_question_count_sync()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    update public.exam_bank set question_count=question_count+1 where id=new.exam_bank_id;
  elsif tg_op='DELETE' then
    update public.exam_bank set question_count=greatest(question_count-1,0) where id=old.exam_bank_id;
  elsif tg_op='UPDATE' and new.exam_bank_id is distinct from old.exam_bank_id then
    update public.exam_bank set question_count=greatest(question_count-1,0) where id=old.exam_bank_id;
    update public.exam_bank set question_count=question_count+1 where id=new.exam_bank_id;
  end if;
  return null;
end $$;

-- Both review edits and publication lock the document first. A stale browser cannot
-- approve old content or publish while another reviewer is changing a unit.
create or replace function public.book_pdf_save_unit(
  p_document_id uuid,p_teacher_id uuid,p_unit_key text,p_expected_version integer,
  p_extraction jsonb,p_validation jsonb,p_review boolean
) returns void language plpgsql security invoker set search_path='' as $$
declare d public.book_pdf_document; u public.book_pdf_unit;
begin
  select * into d from public.book_pdf_document where id=p_document_id and teacher_id=p_teacher_id for update;
  if not found or d.status<>'review' then raise exception '검토할 수 없는 자료입니다.' using errcode='55000'; end if;
  select * into u from public.book_pdf_unit where document_id=d.id and unit_key=p_unit_key for update;
  if not found or u.version<>p_expected_version then raise exception '다른 화면에서 변경됐습니다. 새로고침해주세요.' using errcode='40001'; end if;
  if p_review and jsonb_array_length(p_validation->'errors')<>0 then raise exception '자동 검사 오류를 먼저 수정해주세요.' using errcode='55000'; end if;
  update public.book_pdf_unit set extraction=p_extraction,validation=p_validation,version=version+1,
    reviewed_version=case when p_review then version+1 else null end,
    reviewed_at=case when p_review then now() else null end
    where document_id=d.id and unit_key=p_unit_key;
  update public.book_pdf_document set revision=revision+1 where id=d.id;
end $$;

-- Only the server may invoke these RPCs; authenticated clients cannot forge a
-- clean validation report or change the review/version fields through PostgREST.
revoke all on function public.book_pdf_save_unit(uuid,uuid,text,integer,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.book_pdf_save_unit(uuid,uuid,text,integer,jsonb,jsonb,boolean) to service_role;

create or replace function public.book_pdf_publish(
  p_document_id uuid,p_teacher_id uuid,p_expected_revision integer,p_versions jsonb,p_vocab jsonb
) returns uuid language plpgsql security invoker set search_path='' as $$
declare d public.book_pdf_document; u public.book_pdf_unit; q jsonb; ref jsonb;
  bank uuid; question_id uuid; collection uuid; ordinal integer:=0; expected integer;
begin
  select * into d from public.book_pdf_document where id=p_document_id and teacher_id=p_teacher_id for update;
  if not found then raise exception '자료를 찾을 수 없습니다.' using errcode='55000'; end if;
  if d.status='published' then return d.exam_bank_id; end if;
  if d.status<>'review' or d.revision<>p_expected_revision or not d.metadata_reviewed or d.manifest is null
    or jsonb_array_length(d.manifest->'errors')<>0 then
    raise exception '자료 정보와 문서 경계를 확인해주세요.' using errcode='55000'; end if;
  expected:=jsonb_array_length(d.manifest->'units');
  if expected=0 or (select count(*) from public.book_pdf_unit where document_id=d.id)<>expected then
    raise exception '추출되지 않은 지문 묶음이 있습니다.' using errcode='55000'; end if;
  for u in select * from public.book_pdf_unit where document_id=d.id order by unit_order for update loop
    if u.extraction is null or u.reviewed_version is distinct from u.version
      or (p_versions->>u.unit_key)::integer is distinct from u.version
      or jsonb_array_length(u.validation->'errors')<>0
      or jsonb_array_length(u.extraction->'questions')<>jsonb_array_length(u.manifest->'questions') then
      raise exception '모든 지문 묶음의 최신 내용을 원문과 확인해야 합니다.' using errcode='55000'; end if;
  end loop;
  insert into public.exam_bank(teacher_id,title,exam_year,exam_month,grade,source,form_type,material_kind)
    values(d.teacher_id,d.title,d.academic_year,null,null,'교재',null,'textbook') returning id into bank;
  for u in select * from public.book_pdf_unit where document_id=d.id order by unit_order loop
    for ref in select value from jsonb_array_elements(u.manifest->'questions') loop
      select value into q from jsonb_array_elements(u.extraction->'questions') where value->>'key'=ref->>'key';
      if q is null or (q->>'answer')::integer is distinct from (ref->>'printed_answer')::integer
        or jsonb_array_length(q->'choices')<>5 then raise exception '원문 문항·정답 대응 오류'; end if;
      ordinal:=ordinal+1;
      insert into public.exam_bank_question(exam_bank_id,question_number,question_type,passage,question_text,choices,answer,raw_text,
        explanation_intent,explanation_translation,explanation_solution,explanation_vocabulary,
        source_key,source_label,source_group_key,source_pages,source_document_id)
      values(bank,ordinal,q->>'question_type',u.extraction->>'passage',q->>'stem',q->'choices',
        substr('①②③④⑤',(q->>'answer')::integer,1),u.manifest->>'left_text',q->>'intent',u.extraction->>'translation',q->>'solution',u.extraction->>'vocabulary',
        ref->>'key',ref->>'label',u.unit_key,array(select value::integer from jsonb_array_elements_text(u.manifest->'pages')),d.id)
        returning id into question_id;
      insert into public.exam_bank_question_vocab(question_id,word,normalized_word,meaning,topic,sort_order)
        select question_id,v->>'word',v->>'normalized_word',v->>'meaning',v->>'topic',n::integer
        from jsonb_array_elements(p_vocab) with ordinality as x(v,n) where v->>'key'=ref->>'key';
    end loop;
  end loop;
  if ordinal<>(d.manifest->>'question_count')::integer then raise exception '문항 수가 원문과 다릅니다.'; end if;
  if exists(select 1 from public.exam_bank_question_vocab v join public.exam_bank_question q2 on q2.id=v.question_id where q2.exam_bank_id=bank) then
    insert into public.vocab_collection(teacher_id,title,grade,year_from,year_to,months,source_document_id)
      values(d.teacher_id,d.title||' 어휘',null,d.academic_year,d.academic_year,'{}',d.id) returning id into collection;
    insert into public.vocab_collection_item(collection_id,word,meaning,frequency,topic,sources,sort_order)
      select collection,min(v.word),string_agg(distinct v.meaning,' / '),count(distinct q2.source_group_key)::integer,min(v.topic),
        jsonb_agg(distinct jsonb_build_object('source','교재','source_title',d.title,'source_label',q2.source_label,
          'question_number',q2.question_number,'year',d.academic_year,'month',null,'grade',null)),
        row_number() over(order by v.normalized_word)::integer
      from public.exam_bank_question_vocab v join public.exam_bank_question q2 on q2.id=v.question_id
      where q2.exam_bank_id=bank group by v.normalized_word;
    update public.vocab_collection set item_count=(select count(*) from public.vocab_collection_item where collection_id=collection) where id=collection;
  end if;
  update public.book_pdf_document set status='published',exam_bank_id=bank,published_at=now(),revision=revision+1 where id=d.id;
  return bank;
end $$;
revoke all on function public.book_pdf_publish(uuid,uuid,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.book_pdf_publish(uuid,uuid,integer,jsonb,jsonb) to service_role;

-- Textbook jobs target the draft document rather than the eventual exam ID.
create or replace function public.pdf_import_delete_exam(p_id uuid,p_teacher_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare book_id uuid;
begin
  perform 1 from public.exam_bank where id=p_id and teacher_id=p_teacher_id for update;
  if not found then return false; end if;
  select id into book_id from public.book_pdf_document where exam_bank_id=p_id and teacher_id=p_teacher_id for update;
  perform 1 from public.pdf_import_job where target_id in (p_id,book_id) and teacher_id=p_teacher_id for update;
  if exists(select 1 from public.pdf_import_job where target_id in (p_id,book_id) and teacher_id=p_teacher_id and status in ('queued','running')) then
    raise exception 'PDF import is active' using errcode='55000'; end if;
  delete from public.pdf_import_job where target_id in (p_id,book_id) and teacher_id=p_teacher_id;
  delete from public.exam_bank where id=p_id and teacher_id=p_teacher_id;
  return true;
end $$;
revoke all on function public.pdf_import_delete_exam(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pdf_import_delete_exam(uuid,uuid) to service_role;
commit;


-- Source migration: 20261015130001_book_pdf_auto_verification.sql
-- Apply AFTER 20261015114535_book_pdf_review.sql to both databases.
-- Machine verification replaces the earlier human approval gate.
begin;
alter table public.book_pdf_unit add column if not exists has_extraction boolean generated always as (extraction is not null) stored;
alter table public.book_pdf_unit add column if not exists verified_version integer;
alter table public.book_pdf_unit add column if not exists verification jsonb not null default '{"protocol":1,"status":"pending"}'::jsonb;

create or replace function public.book_pdf_save_unit(
  p_document_id uuid,p_teacher_id uuid,p_unit_key text,p_expected_version integer,
  p_extraction jsonb,p_validation jsonb,p_review boolean
) returns void language plpgsql security invoker set search_path='' as $$
declare d public.book_pdf_document; u public.book_pdf_unit;
begin
  select * into d from public.book_pdf_document where id=p_document_id and teacher_id=p_teacher_id for update;
  if not found or d.status<>'review' then raise exception '검토할 수 없는 자료입니다.' using errcode='55000'; end if;
  select * into u from public.book_pdf_unit where document_id=d.id and unit_key=p_unit_key for update;
  if not found or u.version<>p_expected_version then raise exception '다른 화면에서 변경됐습니다. 새로고침해주세요.' using errcode='40001'; end if;
  if p_review and jsonb_array_length(p_validation->'errors')<>0 then raise exception '자동 검사 오류를 먼저 수정해주세요.' using errcode='55000'; end if;
  update public.book_pdf_unit set extraction=p_extraction,validation=p_validation,version=version+1,
    reviewed_version=null,reviewed_at=null,verified_version=null,verification='{"protocol":1,"status":"pending"}'::jsonb
    where document_id=d.id and unit_key=p_unit_key;
  update public.book_pdf_document set revision=revision+1 where id=d.id;
end $$;

-- Only the server may invoke these RPCs; authenticated clients cannot forge a
-- clean validation report or change the review/version fields through PostgREST.
revoke all on function public.book_pdf_save_unit(uuid,uuid,text,integer,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.book_pdf_save_unit(uuid,uuid,text,integer,jsonb,jsonb,boolean) to service_role;


-- A stale worker or a human checkbox cannot approve or overwrite a newer draft.
drop function if exists public.book_pdf_stage(uuid,uuid,text,jsonb,jsonb);
create or replace function public.book_pdf_stage(
  p_job_id uuid,p_token uuid,p_unit_key text,p_extraction jsonb,p_validation jsonb,p_verification jsonb
) returns void language plpgsql security invoker set search_path='' as $$
declare j public.pdf_import_job; d public.book_pdf_document;
begin
  select * into j from public.pdf_import_job where id=p_job_id and kind='bank_book';
  if not found then raise exception 'worker job missing' using errcode='55000'; end if;
  select * into d from public.book_pdf_document where id=j.target_id and teacher_id=j.teacher_id for update;
  if not found or d.status<>'processing' then raise exception 'draft is no longer processing' using errcode='55000'; end if;
  perform 1 from public.pdf_import_job where id=j.id and status='running' and lease_token=p_token and lease_expires_at>now() for update;
  if not found then raise exception 'worker lease lost' using errcode='55000'; end if;
  if p_unit_key is null then
    update public.book_pdf_document set status='review' where id=d.id;
  else
    if p_verification->>'status'='passed' and (
      coalesce(jsonb_array_length(p_validation->'errors'),-1)<>0 or p_extraction is null
      or p_verification->>'protocol' is distinct from '1' or p_verification->>'extraction_hash' is null
      or p_verification->>'source_hash' is null or coalesce(jsonb_array_length(p_verification->'models'),0)<2
      or (select count(distinct value) from jsonb_array_elements_text(p_verification->'models'))<2
      or d.source_sha256 is null or p_verification->>'pdf_hash' is distinct from d.source_sha256
      or p_verification->'checks' is distinct from '{"boundaries":true,"legibility":true,"formatting":true,"visual_reference":true}'::jsonb
      or coalesce(jsonb_array_length(p_verification->'issues'),-1)<>0
    ) then raise exception 'invalid automated verification' using errcode='55000'; end if;
    update public.book_pdf_unit set extraction=p_extraction,validation=p_validation,verification=p_verification,
      verified_version=case when p_verification->>'status'='passed' then version else null end
      where document_id=d.id and unit_key=p_unit_key;
    if not found then raise exception 'draft unit missing' using errcode='55000'; end if;
  end if;
end $$;
revoke all on function public.book_pdf_stage(uuid,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.book_pdf_stage(uuid,uuid,text,jsonb,jsonb,jsonb) to service_role;

-- Remove the obsolete manual-approval signature so it cannot bypass this gate.
drop function if exists public.book_pdf_publish(uuid,uuid,integer,jsonb,jsonb);
create or replace function public.book_pdf_publish(
  p_document_id uuid,p_teacher_id uuid,p_expected_revision integer,p_versions jsonb,p_hashes jsonb,p_vocab jsonb
) returns uuid language plpgsql security invoker set search_path='' as $$
declare d public.book_pdf_document; u public.book_pdf_unit; q jsonb; ref jsonb;
  bank uuid; question_id uuid; collection uuid; ordinal integer:=0; expected integer;
begin
  select * into d from public.book_pdf_document where id=p_document_id and teacher_id=p_teacher_id for update;
  if not found then raise exception '자료를 찾을 수 없습니다.' using errcode='55000'; end if;
  if d.status='published' then return d.exam_bank_id; end if;
  if d.status<>'review' or d.revision<>p_expected_revision or not d.metadata_reviewed or d.manifest is null
    or coalesce(jsonb_array_length(d.manifest->'errors'),-1)<>0 then
    raise exception '자료 정보와 문서 경계를 확인해주세요.' using errcode='55000'; end if;
  expected:=jsonb_array_length(d.manifest->'units');
  if expected=0 or (select count(*) from public.book_pdf_unit where document_id=d.id)<>expected then
    raise exception '추출되지 않은 지문 묶음이 있습니다.' using errcode='55000'; end if;
  for u in select * from public.book_pdf_unit where document_id=d.id order by unit_order for update loop
    if u.extraction is null or u.verified_version is distinct from u.version
      or (p_versions->>u.unit_key)::integer is distinct from u.version
      or coalesce(jsonb_array_length(u.validation->'errors'),-1)<>0
      or u.verification->>'status' is distinct from 'passed'
      or u.verification->>'protocol' is distinct from '1'
      or d.source_sha256 is null or u.verification->>'pdf_hash' is distinct from d.source_sha256
      or coalesce(jsonb_array_length(u.verification->'issues'),-1)<>0
      or u.verification->'checks' is distinct from '{"boundaries":true,"legibility":true,"formatting":true,"visual_reference":true}'::jsonb
      or (p_hashes->>u.unit_key) is null or (p_hashes->>u.unit_key) is distinct from (u.verification->>'extraction_hash')
      or jsonb_array_length(u.extraction->'questions')<>jsonb_array_length(u.manifest->'questions') then
      raise exception '모든 묶음의 최신 자동 검증이 필요합니다.' using errcode='55000'; end if;
  end loop;
  insert into public.exam_bank(teacher_id,title,exam_year,exam_month,grade,source,form_type,material_kind)
    values(d.teacher_id,d.title,d.academic_year,null,null,'교재',null,'textbook') returning id into bank;
  for u in select * from public.book_pdf_unit where document_id=d.id order by unit_order loop
    for ref in select value from jsonb_array_elements(u.manifest->'questions') loop
      select value into q from jsonb_array_elements(u.extraction->'questions') where value->>'key'=ref->>'key';
      if q is null or (q->>'answer')::integer is distinct from (ref->>'printed_answer')::integer
        or jsonb_array_length(q->'choices')<>5 then raise exception '원문 문항·정답 대응 오류'; end if;
      ordinal:=ordinal+1;
      insert into public.exam_bank_question(exam_bank_id,question_number,question_type,passage,question_text,choices,answer,raw_text,
        explanation_intent,explanation_translation,explanation_solution,explanation_vocabulary,
        source_key,source_label,source_group_key,source_pages,source_document_id)
      values(bank,ordinal,q->>'question_type',u.extraction->>'passage',q->>'stem',q->'choices',
        substr('①②③④⑤',(q->>'answer')::integer,1),u.manifest->>'left_text',q->>'intent',u.extraction->>'translation',q->>'solution',u.extraction->>'vocabulary',
        ref->>'key',ref->>'label',u.unit_key,array(select value::integer from jsonb_array_elements_text(u.manifest->'pages')),d.id)
        returning id into question_id;
      insert into public.exam_bank_question_vocab(question_id,word,normalized_word,meaning,topic,sort_order)
        select question_id,v->>'word',v->>'normalized_word',v->>'meaning',v->>'topic',n::integer
        from jsonb_array_elements(p_vocab) with ordinality as x(v,n) where v->>'key'=ref->>'key';
    end loop;
  end loop;
  if ordinal<>(d.manifest->>'question_count')::integer then raise exception '문항 수가 원문과 다릅니다.'; end if;
  if exists(select 1 from public.exam_bank_question_vocab v join public.exam_bank_question q2 on q2.id=v.question_id where q2.exam_bank_id=bank) then
    insert into public.vocab_collection(teacher_id,title,grade,year_from,year_to,months,source_document_id)
      values(d.teacher_id,d.title||' 어휘',null,d.academic_year,d.academic_year,'{}',d.id) returning id into collection;
    insert into public.vocab_collection_item(collection_id,word,meaning,frequency,topic,sources,sort_order)
      select collection,min(v.word),string_agg(distinct v.meaning,' / '),count(distinct q2.source_group_key)::integer,min(v.topic),
        jsonb_agg(distinct jsonb_build_object('source','교재','source_title',d.title,'source_label',q2.source_label,
          'question_number',q2.question_number,'year',d.academic_year,'month',null,'grade',null)),
        row_number() over(order by v.normalized_word)::integer
      from public.exam_bank_question_vocab v join public.exam_bank_question q2 on q2.id=v.question_id
      where q2.exam_bank_id=bank group by v.normalized_word;
    update public.vocab_collection set item_count=(select count(*) from public.vocab_collection_item where collection_id=collection) where id=collection;
  end if;
  update public.book_pdf_document set status='published',exam_bank_id=bank,published_at=now(),revision=revision+1 where id=d.id;
  return bank;
end $$;
revoke all on function public.book_pdf_publish(uuid,uuid,integer,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.book_pdf_publish(uuid,uuid,integer,jsonb,jsonb,jsonb) to service_role;


notify pgrst, 'reload schema';
commit;


-- Source migration: 20261019110610_book_native_worker_enrichment.sql
-- Apply after 20261015130001 to both databases before deploying the worker.
-- Verified original extraction is retained; generated supplements are separate.
begin;
alter table public.book_pdf_unit add column if not exists enrichment jsonb;
-- This predicate is shared by staging and atomic publication. It checks
-- provenance structure, not whether generated prose is semantically correct.
create or replace function public.book_pdf_valid_proof(v jsonb,x jsonb,m jsonb,e jsonb,pdf_hash text)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
  if coalesce(v->>'status','')<>'passed' or x is null or pdf_hash is null
    or v->>'pdf_hash' is distinct from pdf_hash
    or coalesce(v->>'source_hash','')='' or coalesce(v->>'extraction_hash','')=''
    or coalesce(jsonb_array_length(v->'issues'),-1)<>0
    or v->'checks' is distinct from '{"boundaries":true,"legibility":true,"formatting":true,"visual_reference":true}'::jsonb then return false; end if;
  if v->>'protocol'='1' then
    return coalesce((select count(distinct value) from jsonb_array_elements_text(v->'models')),0)>=2;
  end if;
  if v->>'protocol' is distinct from '2' then return false; end if;
  return coalesce(v->>'pipeline'='native-image-v1'
    and jsonb_array_length(v->'models')>=1
    and v->'audit'->>'last_status'='pass'
    and (v->'audit'->>'rounds')::integer between 1 and 3
    and v->'audit'->>'rounds'=v->>'attempts'
    and v->'audit'->'pages'=m->'pages'
    and jsonb_array_length(m->'pages') between 1 and 4
    and (select count(*) from jsonb_object_keys(v->'audit'->'image_hashes'))=jsonb_array_length(m->'pages')
    and not exists(select 1 from jsonb_array_elements_text(m->'pages') p
      where coalesce(v->'audit'->'image_hashes'->>p,'') !~ '^[a-f0-9]{64}$')
    and v->'audit'->>'native_hash' ~ '^[a-f0-9]{64}$'
    and v->'audit'->>'mapping_hash' ~ '^[a-f0-9]{64}$'
    and v->'audit'->>'extraction_hash'=v->>'extraction_hash'
    and v->>'extraction_hash' ~ '^[a-f0-9]{64}$'
    and v->>'source_hash' ~ '^[a-f0-9]{64}$'
    and pdf_hash ~ '^[a-f0-9]{64}$'
    and v->>'enrichment_hash' ~ '^[a-f0-9]{64}$'
    and e->>'protocol'='1' and e->>'status'='complete'
    and e->>'source_hash'=v->>'extraction_hash'
    and coalesce(e->>'model','')<>'' and (v->'models') ? (e->>'model')
    and jsonb_array_length(e->'questions')=jsonb_array_length(x->'questions')
    and (select count(distinct q->>'key') from jsonb_array_elements(e->'questions') q)=jsonb_array_length(x->'questions')
    and not exists(select 1 from jsonb_array_elements(e->'questions') q
      where coalesce(btrim(q->>'solution'),'')='' or q->>'vocabulary' is null
        or not exists(select 1 from jsonb_array_elements(x->'questions') original where original->>'key'=q->>'key'))
    and jsonb_array_length(x->'questions')=jsonb_array_length(m->'questions'),false);
exception when others then return false;
end $$;
revoke all on function public.book_pdf_valid_proof(jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.book_pdf_valid_proof(jsonb,jsonb,jsonb,jsonb,text) to service_role;

create or replace function public.book_pdf_save_unit(
  p_document_id uuid,p_teacher_id uuid,p_unit_key text,p_expected_version integer,
  p_extraction jsonb,p_validation jsonb,p_review boolean
) returns void language plpgsql security invoker set search_path='' as $$
declare d public.book_pdf_document; u public.book_pdf_unit;
begin
  select * into d from public.book_pdf_document where id=p_document_id and teacher_id=p_teacher_id for update;
  if not found or d.status<>'review' then raise exception '검토할 수 없는 자료입니다.' using errcode='55000'; end if;
  select * into u from public.book_pdf_unit where document_id=d.id and unit_key=p_unit_key for update;
  if not found or u.version<>p_expected_version then raise exception '다른 화면에서 변경됐습니다. 새로고침해주세요.' using errcode='40001'; end if;
  if p_review and jsonb_array_length(p_validation->'errors')<>0 then raise exception '자동 검사 오류를 먼저 수정해주세요.' using errcode='55000'; end if;
  update public.book_pdf_unit set extraction=p_extraction,enrichment=null,validation=p_validation,version=version+1,
    reviewed_version=null,reviewed_at=null,verified_version=null,verification='{"protocol":1,"status":"pending"}'::jsonb
    where document_id=d.id and unit_key=p_unit_key;
  update public.book_pdf_document set revision=revision+1 where id=d.id;
end $$;

-- Only the server may invoke these RPCs; authenticated clients cannot forge a
-- clean validation report or change the review/version fields through PostgREST.
revoke all on function public.book_pdf_save_unit(uuid,uuid,text,integer,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.book_pdf_save_unit(uuid,uuid,text,integer,jsonb,jsonb,boolean) to service_role;



-- Preserve old callers via the optional seventh argument, without RPC ambiguity.
drop function if exists public.book_pdf_stage(uuid,uuid,text,jsonb,jsonb,jsonb);
create or replace function public.book_pdf_stage(
  p_job_id uuid,p_token uuid,p_unit_key text,p_extraction jsonb,p_validation jsonb,p_verification jsonb,p_enrichment jsonb default null
) returns void language plpgsql security invoker set search_path='' as $$
declare j public.pdf_import_job; d public.book_pdf_document;
begin
  select * into j from public.pdf_import_job where id=p_job_id and kind='bank_book';
  if not found then raise exception 'worker job missing' using errcode='55000'; end if;
  select * into d from public.book_pdf_document where id=j.target_id and teacher_id=j.teacher_id for update;
  if not found or d.status<>'processing' then raise exception 'draft is no longer processing' using errcode='55000'; end if;
  perform 1 from public.pdf_import_job where id=j.id and status='running' and lease_token=p_token and lease_expires_at>now() for update;
  if not found then raise exception 'worker lease lost' using errcode='55000'; end if;
  if p_unit_key is null then
    update public.book_pdf_document set status='review' where id=d.id;
  else
    if p_verification->>'status'='passed' and (
      coalesce(jsonb_array_length(p_validation->'errors'),-1)<>0
      or not public.book_pdf_valid_proof(p_verification,p_extraction,
        (select manifest from public.book_pdf_unit where document_id=d.id and unit_key=p_unit_key),p_enrichment,d.source_sha256)
    ) then raise exception 'invalid automated verification' using errcode='55000'; end if;
    update public.book_pdf_unit set extraction=p_extraction,enrichment=p_enrichment,validation=p_validation,verification=p_verification,
      verified_version=case when p_verification->>'status'='passed' then version else null end
      where document_id=d.id and unit_key=p_unit_key;
    if not found then raise exception 'draft unit missing' using errcode='55000'; end if;
  end if;
end $$;
revoke all on function public.book_pdf_stage(uuid,uuid,text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.book_pdf_stage(uuid,uuid,text,jsonb,jsonb,jsonb,jsonb) to service_role;


create or replace function public.book_pdf_publish(
  p_document_id uuid,p_teacher_id uuid,p_expected_revision integer,p_versions jsonb,p_hashes jsonb,p_vocab jsonb
) returns uuid language plpgsql security invoker set search_path='' as $$
declare d public.book_pdf_document; u public.book_pdf_unit; q jsonb; ref jsonb;
  extra jsonb; bank uuid; question_id uuid; collection uuid; ordinal integer:=0; expected integer;
begin
  select * into d from public.book_pdf_document where id=p_document_id and teacher_id=p_teacher_id for update;
  if not found then raise exception '자료를 찾을 수 없습니다.' using errcode='55000'; end if;
  if d.status='published' then return d.exam_bank_id; end if;
  if d.status<>'review' or d.revision<>p_expected_revision or not d.metadata_reviewed or d.manifest is null
    or coalesce(jsonb_array_length(d.manifest->'errors'),-1)<>0 then
    raise exception '자료 정보와 문서 경계를 확인해주세요.' using errcode='55000'; end if;
  expected:=jsonb_array_length(d.manifest->'units');
  if expected=0 or (select count(*) from public.book_pdf_unit where document_id=d.id)<>expected then
    raise exception '추출되지 않은 지문 묶음이 있습니다.' using errcode='55000'; end if;
  for u in select * from public.book_pdf_unit where document_id=d.id order by unit_order for update loop
    if u.extraction is null or u.verified_version is distinct from u.version
      or (p_versions->>u.unit_key)::integer is distinct from u.version
      or coalesce(jsonb_array_length(u.validation->'errors'),-1)<>0
      or u.verification->>'status' is distinct from 'passed'
      or not public.book_pdf_valid_proof(u.verification,u.extraction,u.manifest,u.enrichment,d.source_sha256)
      or d.source_sha256 is null or u.verification->>'pdf_hash' is distinct from d.source_sha256
      or coalesce(jsonb_array_length(u.verification->'issues'),-1)<>0
      or u.verification->'checks' is distinct from '{"boundaries":true,"legibility":true,"formatting":true,"visual_reference":true}'::jsonb
      or (p_hashes->>u.unit_key) is null or (p_hashes->>u.unit_key) is distinct from (u.verification->>'extraction_hash')
      or jsonb_array_length(u.extraction->'questions')<>jsonb_array_length(u.manifest->'questions') then
      raise exception '모든 묶음의 최신 자동 검증이 필요합니다.' using errcode='55000'; end if;
  end loop;
  insert into public.exam_bank(teacher_id,title,exam_year,exam_month,grade,source,form_type,material_kind)
    values(d.teacher_id,d.title,d.academic_year,null,null,'교재',null,'textbook') returning id into bank;
  for u in select * from public.book_pdf_unit where document_id=d.id order by unit_order loop
    for ref in select value from jsonb_array_elements(u.manifest->'questions') loop
      select value into q from jsonb_array_elements(u.extraction->'questions') where value->>'key'=ref->>'key';
      if q is null or (q->>'answer')::integer is distinct from (ref->>'printed_answer')::integer
        or jsonb_array_length(q->'choices')<>5 then raise exception '원문 문항·정답 대응 오류'; end if;
      extra:=null;
      if u.verification->>'protocol'='2' then
        select value into extra from jsonb_array_elements(u.enrichment->'questions') where value->>'key'=ref->>'key';
      end if;
      ordinal:=ordinal+1;
      insert into public.exam_bank_question(exam_bank_id,question_number,question_type,passage,question_text,choices,answer,raw_text,
        explanation_intent,explanation_translation,explanation_solution,explanation_vocabulary,
        source_key,source_label,source_group_key,source_pages,source_document_id)
      values(bank,ordinal,q->>'question_type',u.extraction->>'passage',q->>'stem',q->'choices',
        substr('①②③④⑤',(q->>'answer')::integer,1),u.manifest->>'left_text',q->>'intent',u.extraction->>'translation',
        concat_ws(E'\n\n',q->>'solution',case when extra is not null then '[AI 보완 풀이]'||E'\n'||(extra->>'solution') end),
        concat_ws(E'\n',u.extraction->>'vocabulary',case when nullif(extra->>'vocabulary','') is not null then '[AI 보완 어휘]'||E'\n'||(extra->>'vocabulary') end),
        ref->>'key',ref->>'label',u.unit_key,array(select value::integer from jsonb_array_elements_text(u.manifest->'pages')),d.id)
        returning id into question_id;
      insert into public.exam_bank_question_vocab(question_id,word,normalized_word,meaning,topic,sort_order)
        select question_id,v->>'word',v->>'normalized_word',v->>'meaning',v->>'topic',n::integer
        from jsonb_array_elements(p_vocab) with ordinality as x(v,n) where v->>'key'=ref->>'key';
    end loop;
  end loop;
  if ordinal<>(d.manifest->>'question_count')::integer then raise exception '문항 수가 원문과 다릅니다.'; end if;
  if exists(select 1 from public.exam_bank_question_vocab v join public.exam_bank_question q2 on q2.id=v.question_id where q2.exam_bank_id=bank) then
    insert into public.vocab_collection(teacher_id,title,grade,year_from,year_to,months,source_document_id)
      values(d.teacher_id,d.title||' 어휘',null,d.academic_year,d.academic_year,'{}',d.id) returning id into collection;
    insert into public.vocab_collection_item(collection_id,word,meaning,frequency,topic,sources,sort_order)
      select collection,min(v.word),string_agg(distinct v.meaning,' / '),count(distinct q2.source_group_key)::integer,min(v.topic),
        jsonb_agg(distinct jsonb_build_object('source','교재','source_title',d.title,'source_label',q2.source_label,
          'question_number',q2.question_number,'year',d.academic_year,'month',null,'grade',null)),
        row_number() over(order by v.normalized_word)::integer
      from public.exam_bank_question_vocab v join public.exam_bank_question q2 on q2.id=v.question_id
      where q2.exam_bank_id=bank group by v.normalized_word;
    update public.vocab_collection set item_count=(select count(*) from public.vocab_collection_item where collection_id=collection) where id=collection;
  end if;
  update public.book_pdf_document set status='published',exam_bank_id=bank,published_at=now(),revision=revision+1 where id=d.id;
  return bank;
end $$;
revoke all on function public.book_pdf_publish(uuid,uuid,integer,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.book_pdf_publish(uuid,uuid,integer,jsonb,jsonb,jsonb) to service_role;



notify pgrst, 'reload schema';
commit;


-- 20261021150000_book_pdf_batches.sql
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


-- 20261022141950_book_registration_catalog.sql
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
