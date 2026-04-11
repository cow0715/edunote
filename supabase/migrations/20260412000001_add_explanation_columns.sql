-- 해설 PDF에서 추출한 해설 데이터 컬럼 추가
alter table exam_bank_question
  add column if not exists explanation_intent text default '',
  add column if not exists explanation_translation text default '',
  add column if not exists explanation_solution text default '',
  add column if not exists explanation_vocabulary text default '';

comment on column exam_bank_question.explanation_intent is '출제의도';
comment on column exam_bank_question.explanation_translation is '해석';
comment on column exam_bank_question.explanation_solution is '풀이';
comment on column exam_bank_question.explanation_vocabulary is 'Words and Phrases';
