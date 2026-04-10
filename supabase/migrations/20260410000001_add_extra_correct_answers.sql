-- 객관식 복수정답을 correct_answer_text가 아닌 전용 컬럼에 저장
alter table exam_question
  add column if not exists extra_correct_answers integer[] not null default '{}';

-- 기존 데이터 마이그레이션: correct_answer_text에 "1,3" 형태로 들어있던 objective 복수정답 이전
update exam_question
set extra_correct_answers = (
  select array_agg(v::int)
  from unnest(string_to_array(correct_answer_text, ',')) as v
  where v ~ '^\d+$'
),
correct_answer_text = null
where question_style = 'objective'
  and correct_answer_text is not null
  and correct_answer_text ~ '^\d+(,\d+)*$';
