# 2026-08-26 — 렌더 중 조정 초기값 버그 일괄 수정 (sentinel)

## 발단

운영 배포에서 발견된 버그: 주차 설정 다이얼로그의 **단어 세팅 탭을 닫았다 다시 열면
단어장이 0개**로 표시됨 (채점 완료 여부와 무관, 두 번째 열기부터 항상 재현).

## 원인 — 공통 패턴 결함

"렌더 중 조정" 패턴에서 비교 기준 state 를 `useState(라이브값)` 으로 초기화하면,
캐시(Zustand 스토어 / react-query)가 이미 차 있는 상태에서 **재마운트**될 때
첫 렌더부터 `synced === 라이브값` 이 되어 동기화 분기가 영영 안 걸린다.
편집용 파생 state 는 빈 초기값 그대로 남는다.

react-query 는 refetch 해도 데이터가 deep-equal 이면 참조를 유지(structural sharing)
하므로 저절로 복구되지도 않는다.

수정: 비교 기준 state 초기값을 sentinel(`null`/`undefined`/빈 배열 상수)로 바꿔
마운트 직후에도 동기화가 한 번 걸리게 함. AGENTS.md 의 패턴 예시에도 주의사항 추가.

## 수정 지점 (8곳 / 6파일)

| 파일 | 재마운트 시 증상 |
|---|---|
| `vocab-word-setup.tsx` (syncedSavedWords) | 단어장 0개 — 발단이 된 버그 |
| `vocab-word-setup.tsx` (syncedPrompt) | 저장된 채점 규칙 대신 기본 프롬프트 표시 |
| `sms-sheet.tsx` (syncedPrompt) | 문자 프롬프트 동일 증상 |
| `explanation-editor.tsx` (syncedSnapshot) | 해설 편집 맵이 비어 기존 해설 안 보임 |
| `students/.../report-cards/[reportId]/page.tsx` (syncedCard) | 성적표 재방문 시 빈 폼 |
| `settings/page.tsx` (syncedProfile) | 학원 정보 재방문 시 빈 폼 |
| `attendance-manager.tsx` (syncedRecords) | 저장된 출결이 전부 "출석"으로 보임 |
| `attendance-manager.tsx` (syncedSchedule) | 마운트 직후 목록 밖 날짜 보정 누락 |

검수했지만 안전했던 곳: vocab-sheet-content · exam-sheet-content · question-inputs
(편집본을 prop 으로 시드), question-type-editor · question-edit-dialog (이미 sentinel),
class-form-dialog · vocab-batch-grade-dialog · question-search · vocab-collections ·
report-dispatch · source-image-preview (변경 시 리셋 용도 — 마운트 시점엔 이미 초기 상태).

## 부작용 가능 지점

- sentinel 초기화로 **마운트 직후 동기화 분기가 한 번 더 실행**된다. 각 분기 내용이
  "서버값 → 편집 state 복사"라 멱등이지만, 콜드 마운트(캐시 비어 있음)에서도
  `null → undefined` 전이로 한 번 실행되는 곳이 있다 (sms-sheet: `setPromptText(SMS_RULES)`
  — 초기값과 동일해 무해).
- attendance-manager `syncedSchedule`: 이전엔 안 걸리던 "마운트 직후 날짜 보정"이
  이제 걸린다. 주차 설정을 열었을 때 수업일이 스케줄 목록에 없으면 가장 가까운
  날짜로 이동하는 동작이 첫 표시부터 적용됨 (의도된 동작의 복원).
- 서버/DB/라우트 변경 없음. 순수 클라이언트 상태 초기화 수정.

## 수동 확인 포인트 (배포 후)

1. 주차 설정 → 단어 세팅 → 닫기 → 다시 열기: 단어장 개수 유지되는지 (원 버그)
2. 단어 세팅·문자 발송의 "규칙 수정" 펼침: 저장해 둔 프롬프트가 두 번째 열기에도 뜨는지
3. 주차 설정 다시 열기: 출결 상태(지각/결석)가 유지돼 보이는지
4. 학원 정보 설정 페이지 나갔다 재진입: 폼이 채워져 있는지
5. 성적표 상세 나갔다 재진입: 등급/코멘트/목표 채워져 있는지

검증: `npm run check` 초록불 (에러 0, 테스트 369 통과).
