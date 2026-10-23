-- Apply to development and production before deploying the reviewed-import flow.
-- Existing questions, keys and student answers are never migrated or rewritten.
create table if not exists public.week_answer_draft (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teacher(id) on delete cascade,
  week_id uuid not null references public.week(id) on delete cascade,
  job_id uuid unique references public.pdf_import_job(id) on delete set null,
  status text not null default 'review' check(status in ('review','confirmed')),
  sources jsonb not null,
  answers jsonb not null check(jsonb_typeof(answers)='array' and jsonb_array_length(answers)>0),
  base_questions jsonb not null default '[]'::jsonb,
  reviewed_answers jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid
);
create index if not exists week_answer_draft_owner on public.week_answer_draft(teacher_id,week_id,created_at desc);
alter table public.week_answer_draft enable row level security;
create policy week_answer_draft_owner_read on public.week_answer_draft for select to authenticated
  using (teacher_id in (select id from public.teacher where auth_id=(select auth.uid())));
revoke all on public.week_answer_draft from public,anon,authenticated;
grant select on public.week_answer_draft to authenticated;
grant all on public.week_answer_draft to service_role;

-- Private RPC: the HTTP route derives teacher/auth IDs from verified Auth.
-- Lock + stale-key check + insertion + confirmation are ONE transaction.
create or replace function public.confirm_week_answer_draft(p_id uuid,p_teacher_id uuid,p_auth_id uuid,p_answers jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.week_answer_draft; current_keys jsonb; a jsonb; source jsonb; existing jsonb;
  n int; ordinal int; qid uuid; candidate_key text; seen text[] := '{}';
begin
  select * into d from public.week_answer_draft where id=p_id and teacher_id=p_teacher_id for update;
  if not found then raise exception '검토 초안 접근 권한이 없습니다.'; end if;
  if not exists(select 1 from public.teacher where id=p_teacher_id and auth_id=p_auth_id and approval_status='approved') then
    raise exception '승인된 강사만 확정할 수 있습니다.';
  end if;
  perform 1 from public.week w join public.class c on c.id=w.class_id where w.id=d.week_id and c.teacher_id=p_teacher_id for update of w;
  if not found then raise exception '주차 접근 권한이 없습니다.'; end if;
  if d.status='confirmed' then return jsonb_build_object('ok',true,'already_confirmed',true); end if;
  perform 1 from public.exam_question where week_id=d.week_id and exam_type='reading' order by id for update;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'question_number',question_number,'sub_label',sub_label,
    'question_style',question_style,'correct_answer',correct_answer,'correct_answer_text',correct_answer_text,
    'source_section',source_section,'source_question_number',source_question_number) order by id),'[]'::jsonb)
    into current_keys from public.exam_question where week_id=d.week_id and exam_type='reading';
  if current_keys is distinct from d.base_questions then raise exception '검토 중 기존 정답이 변경됐습니다. 새 초안을 만들어 주세요.'; end if;
  if jsonb_typeof(p_answers)<>'array' or jsonb_array_length(p_answers)<>jsonb_array_length(d.answers) then raise exception '모든 문항을 검토해야 합니다.'; end if;
  if jsonb_array_length(current_keys)>0 and jsonb_array_length(current_keys)<>jsonb_array_length(p_answers) then
    raise exception '기존 문항 구성을 변경할 수 없습니다.';
  end if;
  for source,ordinal in select value,ordinality::int from jsonb_array_elements(d.answers) with ordinality loop
    a := p_answers->(ordinal-1);
    if (a->>'reviewed') is distinct from 'true' or (a->>'question_number') is distinct from (source->>'question_number') then raise exception '문항 검토 정보가 올바르지 않습니다.'; end if;
    if a->>'answer_origin' not in ('source','teacher','existing') or a->>'answer_origin' is null then raise exception '정답 출처를 확인해야 합니다.'; end if;
    if a->>'answer_origin'='source' and (source->>'evidence_verified') is distinct from 'true' then raise exception '원문 근거 없는 정답은 확정할 수 없습니다.'; end if;
    if a->>'answer_origin'='source' and ((a->>'question_style') is distinct from (source->>'question_style')
      or (a->'correct_answer') is distinct from (source->'correct_answer')
      or (a->'correct_answer_text') is distinct from (source->'correct_answer_text')
      or (a->'sub_label') is distinct from (source->'sub_label')) then raise exception '수정한 정답은 직접 검토해야 합니다.'; end if;
    if (a->>'question_number')::int<=0 or (a->>'sub_label' is not null and a->>'sub_label' !~ '^[a-z]$') then raise exception '문항 식별자가 올바르지 않습니다.'; end if;
    if a->>'question_style' not in ('objective','subjective','ox','multi_select','find_error') or a->>'question_style' is null then raise exception '답안 유형이 올바르지 않습니다.'; end if;
    if (a->>'question_style'='objective' and coalesce((a->>'correct_answer')::int,0) not between 1 and 5)
      or (a->>'question_style'<>'objective' and coalesce(trim(a->>'correct_answer_text'),'')='') then raise exception '정답이 비어 있습니다.'; end if;
    candidate_key := (a->>'question_number')||':'||coalesce(a->>'sub_label','');
    if candidate_key=any(seen) then raise exception '문항 식별자 중복'; end if;
    seen := array_append(seen,candidate_key);
    if jsonb_array_length(current_keys)>0 then
      select value into existing from jsonb_array_elements(current_keys) where value->>'question_number'=a->>'question_number'
        and (value->>'sub_label') is not distinct from (a->>'sub_label');
      if existing is null or (existing->>'question_style') is distinct from (a->>'question_style')
        or (existing->'correct_answer') is distinct from (a->'correct_answer')
        or (existing->'correct_answer_text') is distinct from (a->'correct_answer_text') then
        raise exception '기존 정답과 학생 답안은 보존해야 합니다.';
      end if;
      -- Deliberately no UPDATE, DELETE or regrading of existing questions/answers.
    else
      if a->>'answer_origin'='existing' then raise exception '보존할 기존 정답이 없습니다.'; end if;
      insert into public.exam_question(week_id,exam_type,question_number,sub_label,question_style,correct_answer,correct_answer_text,
        grading_criteria,explanation,question_text,question_stem,passage,choices,source_section,source_question_number,display_order,
        passage_group,shared_passage,needs_source_image,source_image_reason,source_page,source_bbox)
      values(d.week_id,'reading',(a->>'question_number')::int,a->>'sub_label',a->>'question_style',
        case when a->>'question_style'='objective' then (a->>'correct_answer')::int else 0 end,
        case when a->>'question_style'='objective' then null else a->>'correct_answer_text' end,
        source->>'grading_criteria',source->>'explanation',source->>'question_text',source->>'question_stem',source->>'passage',
        case when jsonb_typeof(source->'choices')='array' then source->'choices' else null end,
        source->>'source_section',(source->>'source_question_number')::int,(source->>'display_order')::int,
        source->>'passage_group',source->>'shared_passage',coalesce((source->>'needs_source_image')::boolean,false),
        source->>'source_image_reason',(source->>'source_page')::int,nullif(source->'source_bbox','null'::jsonb)) returning id into qid;
      if a->>'concept_tag_id' is not null and exists(select 1 from public.concept_tag where id=(a->>'concept_tag_id')::uuid and teacher_id=p_teacher_id) then
        insert into public.exam_question_tag(exam_question_id,concept_tag_id) values(qid,(a->>'concept_tag_id')::uuid);
      end if;
    end if;
  end loop;
  if jsonb_array_length(current_keys)=0 then
    update public.week set reading_total=jsonb_array_length(p_answers),answer_sheet_path=d.week_id::text||'/'||d.id::text||'-source.pdf' where id=d.week_id;
  end if;
  if d.job_id is not null then
    update public.pdf_import_job set result=coalesce(result,'{}'::jsonb)||'{"needs_review":false,"confirmed":true}'::jsonb where id=d.job_id and status='succeeded';
  end if;
  update public.week_answer_draft set status='confirmed',reviewed_answers=p_answers,confirmed_at=now(),confirmed_by=p_auth_id where id=d.id;
  return jsonb_build_object('ok',true,'questions_parsed',jsonb_array_length(p_answers),'students_regraded',0,'answers_deleted',0);
end;
$$;
revoke all on function public.confirm_week_answer_draft(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_week_answer_draft(uuid,uuid,uuid,jsonb) to service_role;
