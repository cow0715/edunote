-- exam_bank: 시험지 유형 (홀수형/짝수형)
ALTER TABLE exam_bank
  ADD COLUMN IF NOT EXISTS form_type text NOT NULL DEFAULT '홀수형';

-- exam_bank_question: 메가스터디 통계 컬럼
ALTER TABLE exam_bank_question
  ADD COLUMN IF NOT EXISTS difficulty text,
  ADD COLUMN IF NOT EXISTS points integer,
  ADD COLUMN IF NOT EXISTS correct_rate numeric,
  ADD COLUMN IF NOT EXISTS choice_rates jsonb;
