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
