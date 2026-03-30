-- 단어 재시험 기능
-- student_vocab_answer: 재시험 답안 및 채점 결과 컬럼 추가
ALTER TABLE student_vocab_answer
  ADD COLUMN IF NOT EXISTS retake_answer text,
  ADD COLUMN IF NOT EXISTS retake_is_correct boolean;

-- week_score: 재시험 점수 컬럼 추가
ALTER TABLE week_score
  ADD COLUMN IF NOT EXISTS vocab_retake_correct integer;
