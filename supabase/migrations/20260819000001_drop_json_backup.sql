-- 앱 레벨 JSON 백업/복원 기능 폐기 (DB 단 표준 백업으로 대체 예정)
-- restore_truncate_tables 는 SECURITY DEFINER 로 전 테이블을 비우는 함수라 남겨두면 위험하므로 함께 제거한다.
drop function if exists restore_truncate_tables();
drop table if exists backup_log;
