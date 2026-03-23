# EduNote — Claude 협업 규칙

## 커밋 / 푸시
- 사용자가 명시적으로 요청하기 전까지 절대 혼자 커밋하거나 푸시하지 않는다.

## DB 환경
- `.env.local` → 개발 DB (Supabase: otlyfjciikngdoazjusq)
- Vercel 환경변수 → 운영 DB (별도 프로젝트)
- 두 DB는 독립적으로 운영됨

## DB 마이그레이션 규칙
- **스키마 변경(테이블 추가, 컬럼 추가/변경)이 필요한 코드를 작성할 때는 반드시 migration SQL 파일도 함께 만든다.**
- 파일 위치: `supabase/migrations/YYYYMMDDHHMMSS_설명.sql`
- 예시: `supabase/migrations/20260325000001_add_student_note.sql`
- 파일에는 `alter table` 또는 `create table if not exists` 문 작성
- 사용자가 개발/운영 DB 양쪽 SQL Editor에 직접 붙여넣어 적용함
- 전체 초기 스키마: `supabase/migrations/20260323160235_remote_schema.sql`
