# 2026-08-07 — 미커밋 백로그 정리 (첫 /ship)

여러 세션에 걸쳐 쌓인 미커밋 변경 전체. 주제 6개.

## 1. 백업 자동 정리 ⚠️ 운영 영향 큼

- **왜**: 매일 새벽 cron 백업이 지우는 쪽 없이 쌓여 Supabase Storage 용량 초과.
- **무엇**: 백업 업로드 직후 오래된 파일 자동 삭제 ([backup-retention.ts](../../src/lib/backup-retention.ts),
  [backup/route.ts](../../src/app/api/backup/route.ts)). 기본 **최신 14개 보관** (`BACKUP_RETENTION_COUNT`).
  누적분 일회성 정리는 `npm run backups:purge` (기본 미리보기, `--apply` 붙여야 삭제).
- **부작용 가능 지점**:
  - 운영 배포 시 다음 cron부터 실제 삭제 시작. **R2 이중화(backup-todo #1)가 아직 미설정이라
    삭제된 백업은 복구 불가** — 배포 전에 R2 환경변수 먼저 채우는 걸 권장.
  - `backup_YYYY-MM-DD_HHMM.json` 패턴만 삭제. 수동 업로드 파일은 안전.
  - 개수 기반(14개)이지 날짜 기반(30일)이 아님 — todo 문서의 원래 계획과 다름.
- **수동 확인**: 배포 후 `backup_log` 응답의 `pruned`/`kept` 값, Storage 파일 수.

## 2. 단어 사진 URL — 삭제된 파일이면 404

- 서명 URL 생성 실패 시 실제 존재 여부를 확인해서, 파일이 지워진 거면 500 대신 404
  ([vocab-photo-url/route.ts](../../src/app/api/vocab-photo-url/route.ts), 신규 [storage-path.ts](../../src/lib/storage-path.ts)).
- **부작용**: 학부모 화면은 기존처럼 실패 표시. 서버 로그에서 가짜 500이 사라짐.

## 3. PDF import 병렬화 + 비교 도구

- 문제지 청크 파싱을 **동시 2개**로 병렬화, 결과 순서 보존 ([week-reading-import.ts](../../src/lib/week-reading-import.ts)).
  pdfjs `any` 타입도 정리.
- `/dev`에 "PDF Import 비교" 탭 추가 — direct-pdf / local-text / hybrid 모드 비교.
  **실제 LLM 호출 = 과금**, 로그인 필요.
- **부작용**: Anthropic rate limit 소모 2배 속도. 청크 실패 시 fallback 경로는 기존과 동일.

## 4. 채점/문항 UI 정리

- **Tiptap SSR 크래시 수정**: 문항 수정 다이얼로그 열면 페이지 전체가 죽던 버그
  (`immediatelyRender: false`, [exam-bank/page.tsx](../../src/app/(admin)/exam-bank/page.tsx)).
- `set-state-in-effect` 린트 정리: effect 안 setState → 렌더 중 조정으로 전환
  (question-inputs, question-type-editor, source-image-preview, class-form-dialog, exam-bank).
  재시험 페이지 2곳은 의도적 예외로 disable + 주석.
- vocab-word-setup: "단어 직접 수정" 섹션 접기 + 안내문
  (**채점 후 수정해도 점수 유지, 파일 재업로드는 그 주차 점수 초기화**).
- explanation-parser: 출제의도 추출 regex 보강 (`[해석]` 형태 대응).
- **부작용 가능 지점**: 동작 불변이 의도지만 타이밍 민감 — OX 입력의 X 수정어 복원,
  반 수정 다이얼로그 초기값, 재시험 자동 제출.
- **수동 확인**: 채점 화면 OX/서술형 입력, 문항 수정 다이얼로그, 반 수정 다이얼로그.

## 5. 테스트 인프라

- vitest 도입: 유닛 215개(`tests/unit/`, `npm run check` 게이트) + API 하네스(`tests/api/`,
  개발 서버·DB 필요, 게이트 제외). `scripts/test-vocab-xlsx.ts` → `tests/unit/vocab-xlsx.test.ts` 로 이동.

## 6. 에이전트 하네스 (오늘)

- 편집 후 자동 `npm run check` 훅(비동기, 실패 시만 알림), AGENTS.md 규칙 단일화,
  권한 allowlist 정리(커밋/푸시/DB쓰기 자동허용 제거), 스킬 3종(/migration, /api-test, /ship).

## 참고

- `.claude/settings.local.json` 이 git에 올라가 있음 — 과거 커밋에 다른 Supabase 프로젝트
  (rjaawwrcgegfjtiztsou)의 anon key 포함. anon key는 공개 전제(RLS 보호)지만
  로컬 설정은 untrack 하는 게 관례. 커밋 시 결정 필요.
