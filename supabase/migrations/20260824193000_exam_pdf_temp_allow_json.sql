-- 문제지형 청크 분리 가져오기(import-chunk)의 스테이징 JSON 을 exam-pdf-temp 버킷에
-- 저장할 수 있도록 허용 MIME 타입에 application/json 추가.
-- (스테이징 파일은 finalize 성공 시 원본과 함께 삭제된다)
update storage.buckets
set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/json']
where id = 'exam-pdf-temp';
