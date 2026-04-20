-- 기출문제 풀텍스트 검색용 tsvector 컬럼 (지문 + 발문)
-- generated stored 컬럼 + GIN 인덱스 → 별도 트리거 필요 없음

alter table exam_bank_question
  add column if not exists tsv tsvector
  generated always as (
    to_tsvector('simple', coalesce(passage, '') || ' ' || coalesce(question_text, ''))
  ) stored;

create index if not exists idx_exam_bank_question_tsv
  on exam_bank_question using gin (tsv);
