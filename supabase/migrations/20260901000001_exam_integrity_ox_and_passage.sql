-- exam_integrity_issue 에 두 항목 추가
--
-- ① ox_판정_불일치
--    2026-08-25 채점본에서 T/F 문항 13건이 "맞았는데 오답" 으로 저장돼 있었다.
--    당시 gradeOX 에 T/F 표기 분기가 없어서(86d6b19 에서 추가) 정답키 T/F 는 무조건 오답이 됐다.
--    채점 로직을 고쳐도 이미 저장된 is_correct 는 다시 계산되지 않는다 —
--    objective_판정_불일치 의 ox 판이 없어서 몇 달간 아무도 몰랐다. 그 구멍을 막는다.
--    수정어까지 대조해야 하는 "X (were → was)" 형은 SQL 로 재현하면 오탐이 생기므로
--    판정이 기계적으로 확정되는 키(O / T / True / F / False)만 검사한다.
--
-- ② 소문항_지문_없음
--    소문항은 "공통 지문 + 자기 문장" 형태라 passage 를 따로 채워야 화면에서 지문을
--    한 번만 그릴 수 있다. 해설지 파싱 프롬프트가 조각 필드를 요청하지 않아 계속 비어 있었다.
--    기존 181건은 소급하지 않기로 했으므로 프롬프트를 고친 2026-09-01 이후 파싱분만 본다
--    (기준선 0건 — 이 항목이 잡히면 새로 생긴 결함이다).

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
-- 정답을 판정할 근거가 아예 없는 objective 문항.
-- correct_answer 가 비어도 extra_correct_answers 나 all_correct 가 있으면 채점된다.
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
-- ① ox 판정 불일치 — 판정이 확정되는 정답키(O / T / F)만.
--    "X (수정어)" 형은 수정어 대조 규칙(화살표·슬래시·괄호)을 SQL 로 옮기면 오탐이 나므로 제외.
select 'ox_판정_불일치', eq.week_id, eq.id, sa.id,
       format('%s번%s 정답키=%s 학생=%s 저장=%s',
              eq.question_number, coalesce('('||eq.sub_label||')',''),
              eq.correct_answer_text, sa.ox_selection, sa.is_correct)
from student_answer sa
join exam_question eq on eq.id = sa.exam_question_id
where eq.question_style = 'ox'
  and not coalesce(eq.is_void, false)
  and not coalesce(eq.all_correct, false)
  and btrim(eq.correct_answer_text) ~* '^(o|t|true|f|false)$'
  and sa.ox_selection is not null
  and sa.is_correct <> (
    case when btrim(eq.correct_answer_text) ~* '^(o|t|true)$'
         then sa.ox_selection = 'O' else sa.ox_selection = 'X' end)

union all
-- ② 소문항 그룹에 공통 지문(passage)이 하나도 없음 — 프롬프트 수정일(2026-09-01) 이후 파싱분만.
--
--    지문은 출력 길이 때문에 그룹의 첫 소문항에만 싣는다(prompts.ts). 그래서 소문항 하나씩
--    보면 b~e 는 passage 가 비어 있는 게 정상이다 — 반드시 문항 번호 단위로 봐야 한다.
--    기존 181건은 소급 대상이 아니다 (화면은 question_text 통짜 휴리스틱으로 폴백한다).
select '소문항_지문_없음', g.week_id, null::uuid, null::uuid,
       format('%s번: 소문항 %s개 전부 passage 없음', g.question_number, g.n)
from (
  select week_id, question_number, count(*) as n
  from exam_question
  where sub_label is not null and sub_label <> ''
    and created_at >= timestamptz '2026-09-01'
  group by week_id, question_number
  having count(*) filter (where coalesce(btrim(passage), '') <> '') = 0
) g

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
