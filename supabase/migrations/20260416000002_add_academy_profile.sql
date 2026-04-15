-- 학원 브랜딩 & 원장 서명 정보
ALTER TABLE teacher
  ADD COLUMN IF NOT EXISTS academy_name TEXT,
  ADD COLUMN IF NOT EXISTS academy_english_name TEXT,
  ADD COLUMN IF NOT EXISTS academy_address TEXT,
  ADD COLUMN IF NOT EXISTS academy_phone TEXT,
  ADD COLUMN IF NOT EXISTS director_name TEXT;

-- 학생 학번 (성적표 표시용)
ALTER TABLE student
  ADD COLUMN IF NOT EXISTS student_code TEXT;
