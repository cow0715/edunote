-- pdf-temp 스토리지 버킷 생성 (PDF 추출용 임시 저장소)
-- 서버 service role로만 접근하므로 RLS 정책 불필요
INSERT INTO storage.buckets (id, name, public)
VALUES ('pdf-temp', 'pdf-temp', false)
ON CONFLICT DO NOTHING;
