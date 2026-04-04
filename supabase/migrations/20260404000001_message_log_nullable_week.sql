-- message_log.week_id를 nullable로 변경 (공지 문자는 주차 없음)
alter table message_log alter column week_id drop not null;
