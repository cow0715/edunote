# EduNote — 에이전트 공통 협업 규칙

이 파일이 공통 규칙의 원본이다. Claude Code 는 CLAUDE.md 에서 이 파일을 import 하고,
Claude 전용 사항(자동 검증 훅)만 CLAUDE.md 에 따로 둔다. 규칙을 고칠 때는 이 파일을 고친다.

## 검증 (필수)
- **코드 수정 후 반드시 `npm run check` 를 실행한다.** (타입체크 + 린트 + 유닛테스트)
  - 이건 반드시 초록불이어야 한다. 실패하면 작업을 완료로 보고하지 않는다.
  - 자동 훅이 있는 환경(Claude Code)이라도 훅은 알림용 보조 장치일 뿐이다.
    어떤 에이전트든 작업을 마치기 전에는 직접 `npm run check` 를 돌려 확인한다.
- **린트 에러는 0이 기준이다.** warning 은 남아있어도 되지만 새로 늘리지 않는다.
- `react-hooks/set-state-in-effect` 는 대부분 **렌더 중 조정**으로 풀린다:
  ```ts
  const [synced, setSynced] = useState(key)
  if (synced !== key) { setSynced(key); setDerived(...) }
  ```
  effect 안에서 setState 하기 전에 이 형태를 먼저 검토한다.
  정말 못 피하면 `eslint-disable` 하되 **왜 그런지 반드시 주석으로 남긴다.**
- `src/lib/` 의 순수 로직을 수정하면 `tests/unit/` 에 케이스를 추가하거나 갱신한다.
- 유닛테스트는 `tests/unit/**/*.test.ts` 만 실행된다 (vitest, `vitest.config.ts` 참고).
- `npm run test:parse` 는 **실제 LLM을 호출해 과금되므로** 사용자가 요청할 때만 실행한다.
- `it.fails(...)` 로 표시된 테스트는 알려진 미해결 결함이다. 해당 로직을 고쳤다면
  `.fails` 를 떼고 정상 테스트로 바꾼다.

## 디자인 시스템
- **design.md 준수 필수:** 모든 UI 변경은 `design.md`에 정의된 사양을 우선한다.
- design.md가 존재하면 그 파일을 읽고, 그 요구사항에 따라 코드를 수정한다.
- 색상, 그림자, 타이포그래피, 간격 등의 모든 시각적 결정은 design.md에 명시된 사항을 따른다.

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
