-- 기출문제 은행
CREATE TABLE IF NOT EXISTS exam_bank (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES teacher(id) ON DELETE CASCADE,
  title TEXT NOT NULL,                -- '2025년 3월 고2 모의고사'
  exam_year INT NOT NULL,             -- 시행년도, 예: 2025
  exam_month INT NOT NULL,            -- 3, 6, 9, 11(수능)
  grade INT NOT NULL,                 -- 1, 2, 3 (고1/고2/고3)
  source TEXT NOT NULL DEFAULT '교육청', -- '교육청', '평가원', '수능'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exam_bank_question (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_bank_id UUID NOT NULL REFERENCES exam_bank(id) ON DELETE CASCADE,
  question_number INT NOT NULL,
  question_type TEXT NOT NULL,        -- 'purpose', 'blank', 'order', 'insert', 'title', 'summary' 등
  passage TEXT DEFAULT '',
  question_text TEXT NOT NULL,
  choices JSONB DEFAULT '[]',         -- ["① ...", "② ...", "③ ...", "④ ...", "⑤ ..."]
  answer TEXT NOT NULL,               -- '3' 또는 '2,4'
  raw_text TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(exam_bank_id, question_number)
);

-- RLS
ALTER TABLE exam_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_bank_question ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exam_bank_owner" ON exam_bank
  FOR ALL USING (
    teacher_id IN (SELECT id FROM teacher WHERE auth_id = auth.uid())
  );

CREATE POLICY "exam_bank_question_owner" ON exam_bank_question
  FOR ALL USING (
    exam_bank_id IN (
      SELECT eb.id FROM exam_bank eb
      JOIN teacher t ON t.id = eb.teacher_id
      WHERE t.auth_id = auth.uid()
    )
  );

-- 인덱스
CREATE INDEX idx_exam_bank_teacher ON exam_bank(teacher_id);
CREATE INDEX idx_exam_bank_question_bank ON exam_bank_question(exam_bank_id);
CREATE INDEX idx_exam_bank_question_type ON exam_bank_question(question_type);
