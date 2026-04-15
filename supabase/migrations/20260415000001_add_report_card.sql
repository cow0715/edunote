-- 성적표 (월간 / 분기 / 학기)
CREATE TABLE IF NOT EXISTS report_card (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES teacher(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES student(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly', 'semester')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_label TEXT NOT NULL,             -- '2026년 4월', '2026년 2분기', '2026년 1학기' 등
  overall_grade TEXT,                     -- 'A', 'B', 'C', 'D' 등 (선생님이 확정)
  teacher_comment TEXT,                   -- 종합 코멘트
  next_focus TEXT,                        -- 다음 기간 학습 권장
  highlighted_wrong_ids JSONB DEFAULT '[]', -- 선별한 오답 student_answer.id 배열
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  generated_at TIMESTAMPTZ DEFAULT now(),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE report_card ENABLE ROW LEVEL SECURITY;

CREATE POLICY "report_card_owner" ON report_card
  FOR ALL USING (
    teacher_id IN (SELECT id FROM teacher WHERE auth_id = auth.uid())
  );

-- 인덱스
CREATE INDEX idx_report_card_teacher ON report_card(teacher_id);
CREATE INDEX idx_report_card_student ON report_card(student_id);
CREATE INDEX idx_report_card_period ON report_card(student_id, period_start DESC);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_report_card_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_report_card_updated_at
  BEFORE UPDATE ON report_card
  FOR EACH ROW EXECUTE FUNCTION update_report_card_updated_at();
