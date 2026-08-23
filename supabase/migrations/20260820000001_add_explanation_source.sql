-- 해설 출처 구분: 'sheet' = 해설지에서 추출, 'ai' = 해설지에 없어 AI 가 작성
-- (학부모에게 나가는 글이라 강사가 출처를 알 수 있어야 함)
alter table exam_question add column if not exists explanation_source text;
comment on column exam_question.explanation_source is '''sheet''(해설지 원본) | ''ai''(AI 생성) | null(구 데이터)';
