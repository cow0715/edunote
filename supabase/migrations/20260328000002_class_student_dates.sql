-- class_student에 입원일(joined_at) + 퇴원일(left_at) 추가
-- joined_at: 수업 등록일, 기존 데이터는 created_at으로 backfill
-- left_at: 퇴원 시 설정 (null = 재원 중)

ALTER TABLE class_student
  ADD COLUMN IF NOT EXISTS joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS left_at   timestamptz;

-- 기존 데이터 backfill
UPDATE class_student SET joined_at = created_at WHERE joined_at IS NULL;

-- not null 제약 + default 설정
ALTER TABLE class_student
  ALTER COLUMN joined_at SET NOT NULL,
  ALTER COLUMN joined_at SET DEFAULT now();
