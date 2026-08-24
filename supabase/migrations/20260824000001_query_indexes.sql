-- 조회 인덱스 정리 (2026-08-24)
--
-- 근거: 운영 DB 의 pg_stat_user_tables 누적 통계 + 코드 전체의 필터 컬럼 추출 + EXPLAIN ANALYZE 교차 확인.
-- 증가 속도가 빠른 vocab_word_variant / student_vocab_answer / vocab_word 는 이미 인덱스가 잘 걸려 있어
-- 순차스캔이 거의 없다(153·153·1,386회). 아래 3개만 실제로 통째로 읽히고 있었다.

-- ── 1) exam_question — 순차스캔 7,607회 (큰 테이블 중 압도적 1위) ──────────────
-- 코드 19곳이 `.eq('week_id').eq('exam_type').order('question_number')` 로 조회하는데
-- pkey 외에 인덱스가 없었다. EXPLAIN 실측: 30행을 얻으려고 1,227행 전부 읽고 287페이지(2.3MB) 스캔.
create index if not exists idx_exam_question_week_type_number
  on public.exam_question (week_id, exam_type, question_number);

-- ── 2) student_answer — 문항 수정 후 재채점 경로 ──────────────────────────────
-- 기존 unique (week_score_id, exam_question_id) 는 exam_question_id 가 두 번째라
-- `.eq('exam_question_id')` (코드 11곳) 에서 쓸 수 없어 순차스캔했다.
-- 월 999행씩 늘어 exam_question 보다 6.6배 빨리 커진다.
create index if not exists idx_student_answer_exam_question
  on public.student_answer (exam_question_id);

-- ── 3) message_log — 목록이 매번 전체 정렬 ────────────────────────────────────
-- GET /api/message-logs 가 항상 `order('sent_at', desc)` + range 페이지네이션인데 정렬 인덱스가 없었다.
create index if not exists idx_message_log_sent_at
  on public.message_log (sent_at desc);
-- 학생별 필터(`.eq('student_id')`)가 붙는 경우용
create index if not exists idx_message_log_student_sent_at
  on public.message_log (student_id, sent_at desc);
-- 성적표 발송 화면이 `.in('mock_exam_report_id', ...)` 로 조회 (report_card_id 만 인덱스가 있었다)
create index if not exists idx_message_log_mock_exam_report
  on public.message_log (mock_exam_report_id);

-- ── 4) 쓰기 비용만 내던 인덱스 제거 ───────────────────────────────────────────
-- 한 번도 사용되지 않았는데(idx_scan = 0) 월 9,365행 삽입되는 42,931행 테이블에 걸려 있다.
-- 인덱스 중 유일하게 쓰기 비용이 실재하던 곳.
drop index if exists public.idx_vocab_word_variant_exam_enabled;

-- report_card.share_token 에 인덱스가 두 개다.
-- unique 제약(report_card_share_token_key)이 이미 같은 일을 하므로 일반 인덱스는 중복.
drop index if exists public.idx_report_card_share_token;

-- 적용 후 확인용:
--   select relname, seq_scan, idx_scan from pg_stat_user_tables
--   where relname in ('exam_question','student_answer','message_log');
-- (통계는 누적값이라 리셋하려면 select pg_stat_reset();)
