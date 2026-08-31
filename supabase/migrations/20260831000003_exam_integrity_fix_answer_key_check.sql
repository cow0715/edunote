-- exam_integrity_issue ③ 검사 오탐 수정
--
-- "objective 인데 정답 번호가 1~5 밖" 만 보고 8건을 잡았는데, 그중 7건은 정답이
-- correct_answer 가 아니라 extra_correct_answers 에 들어 있었다 (correct_answer=0, extra=[4] 형태).
-- 실제 채점(gradeObjective)은 둘을 합쳐 보므로 정상 동작 중이었다.
--
-- 검사가 봐야 할 것은 "저장 위치" 가 아니라 "정답을 판정할 근거가 아예 없는가" 다.
-- all_correct 문항도 정답키가 필요 없으므로 제외한다.
--
-- 이 파일은 뷰 정의만 바꾼다 (앞 마이그레이션 20260831000002 이 먼저 적용돼 있어야 한다).

create or replace view public.exam_integrity_issue
with (security_invoker = true) as

select '조합선택형_오분리'::text as kind,
       eq.week_id, eq.id as exam_question_id, null::uuid as student_answer_id,
       format('%s번 소문항 %s개가 모두 정답 %s', eq.question_number, cnt.n, eq.correct_answer) as detail
from exam_question eq
join (
  select week_id, question_number, count(*) as n
  from exam_question
  where sub_label is not null and sub_label <> ''
    and question_style = 'objective' and correct_answer is not null
  group by week_id, question_number
  having count(*) > 1 and count(distinct correct_answer) = 1
) cnt on cnt.week_id = eq.week_id and cnt.question_number = eq.question_number
where eq.sub_label is not null and eq.sub_label <> '' and eq.question_style = 'objective'

union all
select 'objective_정답텍스트_혼입', eq.week_id, eq.id, null::uuid,
       format('%s번%s: correct_answer_text 존재', eq.question_number, coalesce('('||eq.sub_label||')',''))
from exam_question eq
where eq.question_style = 'objective'
  and eq.correct_answer_text is not null and btrim(eq.correct_answer_text) <> ''

union all
-- ③ 정답을 판정할 근거가 아예 없는 objective 문항.
--    correct_answer 가 비어도 extra_correct_answers 나 all_correct 가 있으면 채점된다.
select 'objective_정답키_없음', eq.week_id, eq.id, null::uuid,
       format('%s번: correct_answer=%s, extra=%s',
              eq.question_number, eq.correct_answer, coalesce(eq.extra_correct_answers, '{}'::int[]))
from exam_question eq
where eq.question_style = 'objective'
  and not coalesce(eq.is_void, false)
  and not coalesce(eq.all_correct, false)
  and (eq.correct_answer is null or eq.correct_answer not between 1 and 5)
  and coalesce(array_length(eq.extra_correct_answers, 1), 0) = 0

union all
select '소문항_단독', eq.week_id, eq.id, null::uuid,
       format('%s번(%s) 단독', eq.question_number, eq.sub_label)
from exam_question eq
join (
  select week_id, question_number from exam_question
  where sub_label is not null and sub_label <> ''
  group by week_id, question_number having count(*) = 1
) s on s.week_id = eq.week_id and s.question_number = eq.question_number
where eq.sub_label is not null and eq.sub_label <> ''

union all
select '미작성_정답처리', eq.week_id, eq.id, sa.id,
       format('%s번%s', eq.question_number, coalesce('('||eq.sub_label||')',''))
from student_answer sa
join exam_question eq on eq.id = sa.exam_question_id
where sa.is_correct
  and sa.student_answer is null
  and (sa.student_answer_text is null or btrim(sa.student_answer_text) = '')
  and not coalesce(eq.all_correct, false)
  and not coalesce(eq.is_void, false)

union all
select 'objective_판정_불일치', eq.week_id, eq.id, sa.id,
       format('%s번%s 저장=%s 재계산=%s',
              eq.question_number, coalesce('('||eq.sub_label||')',''),
              sa.is_correct,
              case when coalesce(eq.all_correct,false) then true
                   else sa.student_answer = any(array(
                     select x from unnest(array[eq.correct_answer] || coalesce(eq.extra_correct_answers,'{}'::int[])) as x
                      where x > 0)) end)
from student_answer sa
join exam_question eq on eq.id = sa.exam_question_id
where eq.question_style = 'objective'
  and sa.student_answer is not null
  and sa.is_correct <> (
    case when coalesce(eq.all_correct,false) then true
         else sa.student_answer = any(array(
           select x from unnest(array[eq.correct_answer] || coalesce(eq.extra_correct_answers,'{}'::int[])) as x
            where x > 0)) end)

union all
select '중복답안', eq.week_id, eq.id, null::uuid,
       format('%s번%s: %s행', eq.question_number, coalesce('('||eq.sub_label||')',''), d.n)
from (
  select week_score_id, exam_question_id, count(*) as n
  from student_answer group by 1,2 having count(*) > 1
) d
join exam_question eq on eq.id = d.exam_question_id

union all
select '점수합_불일치', ws.week_id, null::uuid, null::uuid,
       format('저장=%s 실제=%s', ws.reading_correct, x.실제)
from week_score ws
join lateral (
  select count(*) filter (
    where sa.is_correct and not coalesce(eq.is_void,false) and eq.exam_type = 'reading'
  ) as 실제
  from student_answer sa join exam_question eq on eq.id = sa.exam_question_id
  where sa.week_score_id = ws.id
) x on true
where ws.reading_correct <> x.실제;
