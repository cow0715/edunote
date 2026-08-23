-- 반의어 variant 출제 활성화 backfill
-- 배경: variant 도입 당시(2026-05) 반의어는 출제 대상이 아니어서 코드에서 exam_enabled=false 로 저장했다.
-- 이후 반의어 출제 유형이 추가됐지만 저장 기본값이 남아 있어 반의어 문항이 단 한 번도 생성되지 않았다.
-- 코드 기본값을 true 로 바꾸면서 기존 행도 함께 켠다. (되돌리기: 같은 조건으로 false 로 되돌리면 됨)
update vocab_word_variant
set exam_enabled = true
where relation_type = 'antonym'
  and exam_enabled = false;
