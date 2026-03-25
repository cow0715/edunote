-- find_error question_style 추가 (DB 스키마 변경 없음 — text 컬럼이라 CHECK constraint 없음)
-- question_style 허용 값: 'objective' | 'subjective' | 'ox' | 'multi_select' | 'find_error'
-- find_error: "틀린 것 찾아 고치시오" 유형
--   correct_answer = 0
--   correct_answer_text = '기호:수정어' (예: 'c:asked', 'e:watching')
--   채점: 코드 레벨 집합 매칭 (순서 무관)
comment on column exam_question.question_style is 'objective | subjective | ox | multi_select | find_error';
