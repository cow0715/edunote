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
