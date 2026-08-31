-- 시험 데이터 정합성 점검 뷰
--
-- 지금까지 나온 결함(조합 선택형 오분리, ox 미작성 정답 처리, all_correct 미반영 등)은
-- 전부 몇 달 뒤에 손으로 SQL 을 뒤져서 발견됐다. 고치는 것보다 "보이게 만드는 것" 이 먼저다.
--
-- 규칙은 하나뿐이다: **논리적으로 불가능한 상태만 잡는다.**
-- LLM 출력이 어떤 모양이든, 사람이 어떻게 고쳤든 성립할 수 없는 조합만 모은다.
-- 모양을 가정하고 짠 방어(collapseSplitObjectiveQuestion)가 실제 출력과 어긋나
-- 무용지물이었던 전례가 있어서다.
--
-- 드릴다운이 되도록 카운트가 아니라 행을 돌려준다. 요약은 exam_integrity_summary() 가 한다.

create or replace view public.exam_integrity_issue
with (security_invoker = true) as

-- ① 조합 선택형 오분리
--    학생은 ①~⑤ 중 하나만 고른다. 독립된 소문항 둘이 같은 번호를 정답으로 가질 수 없다.
--    (진짜 어법 'n개 고르' 는 정답이 ②④ 처럼 서로 다르다)
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
-- ② objective 인데 정답 텍스트가 채워짐 → 스타일 오판 (subjective 여야 할 가능성)
select 'objective_정답텍스트_혼입', eq.week_id, eq.id, null::uuid,
       format('%s번%s: correct_answer_text 존재', eq.question_number, coalesce('('||eq.sub_label||')',''))
from exam_question eq
where eq.question_style = 'objective'
  and eq.correct_answer_text is not null and btrim(eq.correct_answer_text) <> ''

union all
-- ③ objective 인데 정답 번호가 1~5 밖 (무효 문항 제외)
select 'objective_정답번호_이탈', eq.week_id, eq.id, null::uuid,
       format('%s번: correct_answer=%s', eq.question_number, eq.correct_answer)
from exam_question eq
where eq.question_style = 'objective'
  and not coalesce(eq.is_void, false)
  and (eq.correct_answer is null or eq.correct_answer not between 1 and 5)

union all
-- ④ sub_label 이 붙었는데 그 문항에 행이 하나뿐 → 분리의 의미가 없음
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
-- ⑤ 학생이 아무것도 안 썼는데 정답 처리 (전원 정답·무효 문항 제외)
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
-- ⑥ objective 판정이 실제 규칙과 어긋남
--    규칙: all_correct 면 무조건 정답, 아니면 (correct_answer + extra_correct_answers) 포함 여부
--    lib/objective-grading.ts 의 gradeObjective 와 같은 판정이어야 한다.
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
-- ⑦ 같은 회차·문항에 답안이 두 행 이상
select '중복답안', eq.week_id, eq.id, null::uuid,
       format('%s번%s: %s행', eq.question_number, coalesce('('||eq.sub_label||')',''), d.n)
from (
  select week_score_id, exam_question_id, count(*) as n
  from student_answer group by 1,2 having count(*) > 1
) d
join exam_question eq on eq.id = d.exam_question_id

union all
-- ⑧ week_score.reading_correct 가 실제 정답 수와 다름
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

comment on view public.exam_integrity_issue is
  '시험 데이터에서 논리적으로 성립할 수 없는 상태를 모은 뷰. kind 별로 세어 매일 cron 이 감시한다.';

-- 요약 — cron 은 이것만 읽는다 (행 전체를 끌어오지 않게)
create or replace function public.exam_integrity_summary()
returns table (kind text, count bigint)
language sql
stable
as $$
  select kind, count(*) from public.exam_integrity_issue group by kind order by count(*) desc;
$$;

comment on function public.exam_integrity_summary() is
  'exam_integrity_issue 를 kind 별로 집계. 0 이 아닌 항목이 있으면 cron 이 로그를 남긴다.';
