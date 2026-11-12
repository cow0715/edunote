-- Apply to development and production before releasing the matching API code.
-- Each RPC is one PostgreSQL transaction; no service-role/SECURITY DEFINER bypass.
begin;
alter table public.week_score add column if not exists grade_revision bigint not null default 0;

create or replace function public.bump_grade_revision()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  -- Photo linkage is storage metadata, not a change to the answers being graded.
  if (to_jsonb(new)-array['grade_revision','exam_photo_path','vocab_photo_path']) =
     (to_jsonb(old)-array['grade_revision','exam_photo_path','vocab_photo_path'])
     and new.grade_revision=old.grade_revision then return new; end if;
  new.grade_revision := old.grade_revision + 1;
  return new;
end $$;
drop trigger if exists week_score_grade_revision on public.week_score;
create trigger week_score_grade_revision before update on public.week_score
for each row execute function public.bump_grade_revision();

create or replace function public.touch_answer_grade_revision()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new is not distinct from old then return new; end if;
  end if;
  if tg_op = 'DELETE' then
    update public.week_score set grade_revision=grade_revision+1 where id=old.week_score_id;
    return old;
  end if;
  update public.week_score set grade_revision=grade_revision+1 where id=new.week_score_id;
  if tg_op='UPDATE' and old.week_score_id<>new.week_score_id then
    update public.week_score set grade_revision=grade_revision+1 where id=old.week_score_id;
  end if;
  return new;
end $$;
drop trigger if exists student_answer_grade_revision on public.student_answer;
create trigger student_answer_grade_revision after insert or update or delete on public.student_answer
for each row execute function public.touch_answer_grade_revision();
drop trigger if exists student_vocab_answer_grade_revision on public.student_vocab_answer;
create trigger student_vocab_answer_grade_revision after insert or update or delete on public.student_vocab_answer
for each row execute function public.touch_answer_grade_revision();

create or replace function public.assert_grade_week_owner(p_week_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare class_id uuid;
begin
  select w.class_id into class_id from public.week w join public.class c on c.id=w.class_id
    join public.teacher t on t.id=c.teacher_id
    where w.id=p_week_id and (current_user='service_role' or (t.auth_id=auth.uid() and t.approval_status='approved'));
  if not found then raise exception '채점 권한이 없습니다.' using errcode='42501'; end if;
  return class_id;
end $$;

create or replace function public.recalculate_reading_scores(p_score_ids uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare w uuid;
begin
  for w in select distinct week_id from public.week_score where id=any(p_score_ids) loop
    perform public.assert_grade_week_owner(w);
  end loop;
  perform id from public.week_score where id=any(p_score_ids) order by id for update;
  update public.week_score s set reading_correct=(
    select case when count(*)=0 then null else count(*) filter(where a.is_correct)::integer end
    from public.student_answer a join public.exam_question q on q.id=a.exam_question_id
    where a.week_score_id=s.id and q.week_id=s.week_id and q.exam_type='reading' and not coalesce(q.is_void,false)
  ) where s.id=any(p_score_ids);
end $$;

-- This unreleased migration previously returned void; allow local reapplication too.
drop function if exists public.save_week_reading_grades(uuid,jsonb);
create function public.save_week_reading_grades(p_week_id uuid,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare cls uuid; r jsonb; a jsonb; s public.week_score; sid uuid; ids uuid[] := '{}';
begin
  cls := public.assert_grade_week_owner(p_week_id);
  -- Serialise grade commits and week configuration changes, but never hold a lock during AI work.
  perform id from public.week where id=p_week_id for update;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception '학생 목록이 필요합니다.' using errcode='22023'; end if;
  if (select count(*) from jsonb_array_elements(p_rows)) <>
     (select count(distinct value->>'student_id') from jsonb_array_elements(p_rows)) then
    raise exception '학생이 중복되었습니다.' using errcode='22023';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r->'present') is distinct from 'boolean' or jsonb_typeof(r->'reading_present') is distinct from 'boolean' then
      raise exception '응시 여부를 확인하지 못했습니다.' using errcode='22023';
    end if;
    if not exists(select 1 from public.class_student where class_id=cls and student_id=(r->>'student_id')::uuid) then
      raise exception '수업에 속하지 않은 학생입니다.' using errcode='22023';
    end if;
    select * into s from public.week_score where week_id=p_week_id and student_id=(r->>'student_id')::uuid for update;
    if (r->>'expected_revision') is null then
      -- OCR may have created a photo-only parent after the screen was loaded.
      -- Never treat a row containing grades, metadata or historical answers as empty.
      if found and not (s.grade_revision=0 and s.exam_photo_path is not null
        and s.vocab_correct is null and s.reading_correct is null and s.homework_done is null and s.memo is null
        and not exists(select 1 from public.student_answer where week_score_id=s.id)
        and not exists(select 1 from public.student_vocab_answer where week_score_id=s.id)) then
        raise exception '다른 저장이 먼저 완료됐습니다. 새로고침 후 다시 시도해주세요.' using errcode='40001';
      end if;
    elsif not found or s.id<>(r->>'score_id')::uuid or s.grade_revision<>(r->>'expected_revision')::bigint then
      raise exception '채점 중 답안이 변경됐습니다. 새로고침 후 다시 시도해주세요.' using errcode='40001';
    end if;
    if not (r->>'present')::boolean then
      delete from public.week_score where week_id=p_week_id and student_id=(r->>'student_id')::uuid;
      continue;
    end if;
    if r->>'exam_photo_path' is not null and r->>'exam_photo_path' <> p_week_id::text||'/'||(r->>'student_id')
      and r->>'exam_photo_path' not like p_week_id::text||'/'||(r->>'student_id')||'/%' then
      raise exception '사진 경로가 올바르지 않습니다.' using errcode='22023';
    end if;
    sid := coalesce(s.id,(r->>'score_id')::uuid);
    insert into public.week_score(id,week_id,student_id,vocab_correct,reading_correct,homework_done,memo,exam_photo_path)
      values(sid,p_week_id,(r->>'student_id')::uuid,(r->>'vocab_correct')::integer,
        case when (r->>'reading_present')::boolean then s.reading_correct else null end,
        (r->>'homework_done')::numeric,nullif(r->>'memo',''),case when (r->>'reading_present')::boolean then coalesce(r->>'exam_photo_path',s.exam_photo_path) else s.exam_photo_path end)
      on conflict(week_id,student_id) do update set vocab_correct=excluded.vocab_correct,
        reading_correct=excluded.reading_correct,homework_done=excluded.homework_done,memo=excluded.memo,exam_photo_path=excluded.exam_photo_path;
    if not (r->>'reading_present')::boolean then continue; end if;
    if jsonb_typeof(r->'answers') is distinct from 'array' then raise exception '답안 목록이 필요합니다.' using errcode='22023'; end if;
    if (select count(*) from jsonb_array_elements(r->'answers')) <>
       (select count(distinct value->>'exam_question_id') from jsonb_array_elements(r->'answers')) then
      raise exception '문항이 중복되었습니다.' using errcode='22023';
    end if;
    for a in select value from jsonb_array_elements(r->'answers') loop
      if not exists(select 1 from public.exam_question where id=(a->>'exam_question_id')::uuid
        and week_id=p_week_id and exam_type='reading' and not coalesce(is_void,false)) then
        raise exception '시험 문항이 변경됐습니다. 새로고침해주세요.' using errcode='40001';
      end if;
      insert into public.student_answer(week_score_id,exam_question_id,student_answer,student_answer_text,
        ox_selection,is_correct,needs_review,teacher_confirmed,ai_feedback)
      values(sid,(a->>'exam_question_id')::uuid,(a->>'student_answer')::integer,a->>'student_answer_text',
        a->>'ox_selection',coalesce((a->>'is_correct')::boolean,false),coalesce((a->>'needs_review')::boolean,false),
        coalesce((a->>'teacher_confirmed')::boolean,false),a->>'ai_feedback')
      on conflict(week_score_id,exam_question_id) do update set student_answer=excluded.student_answer,
        student_answer_text=excluded.student_answer_text,ox_selection=excluded.ox_selection,is_correct=excluded.is_correct,
        needs_review=excluded.needs_review,teacher_confirmed=excluded.teacher_confirmed,ai_feedback=excluded.ai_feedback;
    end loop;
    ids := array_append(ids,sid);
  end loop;
  perform public.recalculate_reading_scores(ids);
  update public.week set reading_total=(select count(*) from public.exam_question
    where week_id=p_week_id and exam_type='reading' and not coalesce(is_void,false))
    where id=p_week_id and reading_total=0;
  return (select coalesce(jsonb_agg(jsonb_build_object('student_id',r.value->>'student_id',
    'score_id',ws.id,'revision',ws.grade_revision)),'[]'::jsonb)
    from jsonb_array_elements(p_rows) r left join public.week_score ws
      on ws.week_id=p_week_id and ws.student_id=(r.value->>'student_id')::uuid);
end $$;

create or replace function public.save_week_grade_metadata(
  p_week_id uuid,p_student_id uuid,p_score_id uuid,p_expected_revision bigint,p_changes jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cls uuid; s public.week_score;
begin
  cls := public.assert_grade_week_owner(p_week_id);
  perform id from public.week where id=p_week_id for update;
  if not exists(select 1 from public.class_student where class_id=cls and student_id=p_student_id) then
    raise exception '수업에 속하지 않은 학생입니다.' using errcode='22023';
  end if;
  select * into s from public.week_score where week_id=p_week_id and student_id=p_student_id for update;
  if p_expected_revision is null then
    if found then raise exception '다른 저장이 먼저 완료됐습니다. 새로고침해주세요.' using errcode='40001'; end if;
    insert into public.week_score(id,week_id,student_id) values(p_score_id,p_week_id,p_student_id) returning * into s;
  elsif not found or s.id<>p_score_id or s.grade_revision<>p_expected_revision then
    raise exception '답안이 변경됐습니다. 새로고침해주세요.' using errcode='40001';
  end if;
  update public.week_score set
    homework_done=case when p_changes ? 'homework_done' then (p_changes->>'homework_done')::numeric else homework_done end,
    memo=case when p_changes ? 'memo' then nullif(p_changes->>'memo','') else memo end
    where id=s.id returning * into s;
  return jsonb_build_array(jsonb_build_object('student_id',p_student_id,'score_id',s.id,'revision',s.grade_revision));
end $$;

create or replace function public.save_week_vocab_grade(
  p_week_id uuid,p_student_id uuid,p_score_id uuid,p_expected_revision bigint,p_expected_test_id uuid,
  p_words jsonb,p_answers jsonb,p_photo_path text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cls uuid; s public.week_score; active_test uuid; w jsonb; a jsonb; wid uuid;
  expected uuid[]; received uuid[] := '{}'; correct_count integer; total_count integer;
begin
  cls := public.assert_grade_week_owner(p_week_id);
  perform id from public.week where id=p_week_id for update;
  if not exists(select 1 from public.class_student where class_id=cls and student_id=p_student_id) then
    raise exception '수업에 속하지 않은 학생입니다.' using errcode='22023';
  end if;
  select id into active_test from public.vocab_test where week_id=p_week_id and is_active order by created_at desc limit 1;
  if active_test is distinct from p_expected_test_id then
    raise exception '시험지가 변경됐습니다. 새로고침 후 다시 시도해주세요.' using errcode='40001';
  end if;
  select * into s from public.week_score where week_id=p_week_id and student_id=p_student_id for update;
  if p_expected_revision is null then
    if found then raise exception '다른 저장이 먼저 완료됐습니다. 다시 시도해주세요.' using errcode='40001'; end if;
  elsif not found or s.id<>p_score_id or s.grade_revision<>p_expected_revision then
    raise exception '채점 중 답안이 변경됐습니다. 다시 시도해주세요.' using errcode='40001';
  end if;
  if p_photo_path is null or p_photo_path not like p_week_id::text||'/'||p_student_id::text||'/%' then
    raise exception '사진 저장 경로가 올바르지 않습니다.' using errcode='22023';
  end if;
  if jsonb_typeof(p_words) is distinct from 'array' or jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers)=0 then
    raise exception '채점할 답안이 없습니다.' using errcode='22023';
  end if;
  if active_test is null then
    if jsonb_array_length(p_words)>0 and exists(select 1 from public.vocab_word where week_id=p_week_id) then
      raise exception '단어 목록이 변경됐습니다. 다시 시도해주세요.' using errcode='40001';
    end if;
    for w in select value from jsonb_array_elements(p_words) loop
      if coalesce((w->>'number')::integer,0)<1 or nullif(btrim(w->>'english_word'),'') is null then
        raise exception '단어 문항을 확인하지 못했습니다.' using errcode='22023';
      end if;
      insert into public.vocab_word(week_id,number,english_word) values(p_week_id,(w->>'number')::integer,w->>'english_word')
        on conflict(week_id,number) do nothing;
    end loop;
    select array_agg(id order by id) into expected from public.vocab_word where week_id=p_week_id;
  else
    select array_agg(distinct vocab_word_id order by vocab_word_id) into expected from public.vocab_test_item where vocab_test_id=active_test;
  end if;
  insert into public.week_score(id,week_id,student_id) values(p_score_id,p_week_id,p_student_id)
    on conflict(week_id,student_id) do nothing;
  for a in select value from jsonb_array_elements(p_answers) loop
    wid := (a->>'vocab_word_id')::uuid;
    if wid is null then
      select id into wid from public.vocab_word where week_id=p_week_id and number=(a->>'test_number')::integer;
    end if;
    if wid is null or not (wid=any(coalesce(expected,'{}'))) or wid=any(received) then
      raise exception '문항 연결을 확인하지 못했습니다. 다시 촬영해주세요.' using errcode='22023';
    end if;
    if active_test is null then
      if not exists(select 1 from public.vocab_word where id=wid and number=(a->>'test_number')::integer)
        or (a->>'vocab_word_variant_id') is not null then
        raise exception '문항 연결이 변경됐습니다.' using errcode='40001';
      end if;
    elsif not exists(select 1 from public.vocab_test_item where vocab_test_id=active_test and vocab_word_id=wid
      and test_number=(a->>'test_number')::integer
      and vocab_word_variant_id is not distinct from (a->>'vocab_word_variant_id')::uuid) then
      raise exception '시험 문항이 변경됐습니다. 다시 시도해주세요.' using errcode='40001';
    end if;
    if (a->>'vocab_word_variant_id') is not null and not exists(
      select 1 from public.vocab_word_variant where id=(a->>'vocab_word_variant_id')::uuid and vocab_word_id=wid
    ) then raise exception '단어 연결이 변경됐습니다.' using errcode='40001'; end if;
    received := array_append(received,wid);
    insert into public.student_vocab_answer(week_score_id,vocab_word_id,vocab_word_variant_id,test_number,test_word,test_source,student_answer,is_correct)
      values(p_score_id,wid,(a->>'vocab_word_variant_id')::uuid,(a->>'test_number')::integer,
        a->>'test_word',a->>'test_source',a->>'student_answer',coalesce((a->>'is_correct')::boolean,false))
      on conflict(week_score_id,vocab_word_id) do update set vocab_word_variant_id=excluded.vocab_word_variant_id,
        test_number=excluded.test_number,test_word=excluded.test_word,test_source=excluded.test_source,
        student_answer=excluded.student_answer,is_correct=excluded.is_correct
      where not public.student_vocab_answer.teacher_locked;
  end loop;
  if cardinality(received)<>coalesce(cardinality(expected),0) then
    raise exception '일부 문항을 읽지 못해 기존 채점 결과를 유지했습니다. 다시 촬영해주세요.' using errcode='22023';
  end if;
  select count(*) filter(where is_correct)::integer,count(*)::integer into correct_count,total_count
    from public.student_vocab_answer where week_score_id=p_score_id and vocab_word_id=any(expected);
  if total_count<>cardinality(expected) then raise exception '답안 저장을 확인하지 못했습니다.'; end if;
  update public.week_score set vocab_correct=correct_count,vocab_photo_path=p_photo_path where id=p_score_id;
  update public.week set vocab_total=total_count where id=p_week_id;
  return jsonb_build_object('vocab_correct',correct_count,'vocab_total',total_count);
end $$;

create or replace function public.save_vocab_answer_edits(
  p_score_id uuid,p_expected_revision bigint,p_answers jsonb,p_regrade boolean,p_expected_test_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.week_score; a jsonb; active uuid; expected uuid[];
begin
  select * into s from public.week_score where id=p_score_id;
  if not found then raise exception '답안이 변경됐습니다.' using errcode='40001'; end if;
  perform public.assert_grade_week_owner(s.week_id);
  perform id from public.week where id=s.week_id for update;
  select * into s from public.week_score where id=p_score_id for update;
  if not found or p_expected_revision is null or s.grade_revision<>p_expected_revision then
    raise exception '답안이 변경됐습니다. 편집 내용을 유지했습니다. 새로고침 후 확인해주세요.' using errcode='40001';
  end if;
  select id into active from public.vocab_test where week_id=s.week_id and is_active order by created_at desc limit 1;
  if active is distinct from p_expected_test_id then raise exception '시험지가 변경됐습니다.' using errcode='40001'; end if;
  if active is null then
    select array_agg(id) into expected from public.vocab_word where week_id=s.week_id;
  else
    select array_agg(vocab_word_id) into expected from public.vocab_test_item where vocab_test_id=active;
  end if;
  if jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers)=0 or
    (select count(*) from jsonb_array_elements(p_answers)) <> (select count(distinct value->>'id') from jsonb_array_elements(p_answers)) then
    raise exception '답안 목록을 확인해주세요.' using errcode='22023';
  end if;
  for a in select value from jsonb_array_elements(p_answers) loop
    if not exists(select 1 from public.student_vocab_answer where id=(a->>'id')::uuid and week_score_id=s.id
      and vocab_word_id=any(coalesce(expected,'{}')) and (not p_regrade or not teacher_locked)) then
      raise exception '답안 또는 교사 확정 상태가 변경됐습니다.' using errcode='40001';
    end if;
    update public.student_vocab_answer set student_answer=a->>'student_answer',is_correct=(a->>'is_correct')::boolean,
      teacher_locked=case when p_regrade then false when a ? 'teacher_locked' then (a->>'teacher_locked')::boolean else teacher_locked end
      where id=(a->>'id')::uuid;
  end loop;
  update public.week_score set vocab_correct=(select count(*)::integer from public.student_vocab_answer
    where week_score_id=s.id and vocab_word_id=any(coalesce(expected,'{}')) and is_correct)
    where id=s.id returning * into s;
  return jsonb_build_array(jsonb_build_object('student_id',s.student_id,'score_id',s.id,'revision',s.grade_revision));
end $$;
revoke all on function public.save_vocab_answer_edits(uuid,bigint,jsonb,boolean,uuid) from public,anon;
grant execute on function public.save_vocab_answer_edits(uuid,bigint,jsonb,boolean,uuid) to authenticated,service_role;

revoke all on function public.save_week_grade_metadata(uuid,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.save_week_grade_metadata(uuid,uuid,uuid,bigint,jsonb) to authenticated,service_role;

revoke all on function public.assert_grade_week_owner(uuid), public.recalculate_reading_scores(uuid[]),
  public.save_week_reading_grades(uuid,jsonb),public.save_week_vocab_grade(uuid,uuid,uuid,bigint,uuid,jsonb,jsonb,text) from public,anon;
grant execute on function public.assert_grade_week_owner(uuid), public.recalculate_reading_scores(uuid[]),
  public.save_week_reading_grades(uuid,jsonb),public.save_week_vocab_grade(uuid,uuid,uuid,bigint,uuid,jsonb,jsonb,text) to authenticated,service_role;
do $$ begin
  if exists(select 1 from pg_roles where rolname='edunote_app') then
    grant execute on function public.save_vocab_answer_edits(uuid,bigint,jsonb,boolean,uuid) to edunote_app;
    grant execute on function public.save_week_grade_metadata(uuid,uuid,uuid,bigint,jsonb) to edunote_app;
    grant execute on function public.assert_grade_week_owner(uuid),public.recalculate_reading_scores(uuid[]),
      public.save_week_reading_grades(uuid,jsonb),public.save_week_vocab_grade(uuid,uuid,uuid,bigint,uuid,jsonb,jsonb,text) to edunote_app;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
