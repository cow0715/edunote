-- 성적표 자동 요약 문장 (편집 가능)
ALTER TABLE report_card
  ADD COLUMN IF NOT EXISTS summary_text TEXT;
