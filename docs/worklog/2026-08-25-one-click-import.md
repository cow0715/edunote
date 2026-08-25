# 2026-08-25 — 원클릭 가져오기: 정오표·AI 해설도 청크 분리 (Phase B)

전날 `chunked-problem-sheet-import.md`(문제지 구조 파싱 분리)의 후속. 정오표와 AI 해설까지
같은 패턴으로 분리하고, 세 단계를 버튼 1회로 자동 연결했다.

## 1. 구조 — 클릭 1회에 나가는 요청들

```
[한 번에 가져오기 클릭]
 1단계 문항 구조   plan → import-chunk ×N (동시 4) → import-finalize        (전날 작업)
 2단계 정답 반영   plan(mode:answer_key) → answer-key-chunk ×M → answer-key-finalize
 3단계 AI 해설     explanations-drain 반복 (remaining 0 까지, 요청당 4배치=24문항)
```

- 큰 데이터(PDF·파싱 JSON)는 함수↔스토리지 안쪽 통신으로만 이동, 브라우저↔함수
  출입구(4.5MB 제한)로는 경로·카운트만 지나간다.
- 병합("같은 번호는 뒤가 이긴다")·문항 수 검증·DB 반영은 answer-key-finalize 에만 있음
  (문제지형과 같은 불변식). 청크 재요청 멱등, finalize 실패 시 스테이징 보존.
- 해설 드레인은 "해설 없는 문항만" 고르므로 몇 번을 불러도 멱등. 실패 배치 문항은
  remaining 에 안 세서 영구 실패가 있어도 루프 종료 (완료 메시지에 실패 표시,
  정오표 재실행 시 이어서 생성).

## 2. 파일

- lib: [week-reading-import.ts](../../src/lib/week-reading-import.ts) —
  `fetchAnswerKeyQuestionContext` / `planAnswerKeyChunks` / `parseAnswerKeyChunkForStaging`
  / `finalizeAnswerKeyItems`(순수) 분해, `applyAnswerKeyWithoutRegrade` 를 라우트 로컬에서
  lib 로 승격. [reading-explanations.ts](../../src/lib/reading-explanations.ts) —
  `maxBatches`/`remaining` 지원.
- 라우트: `import-plan`(mode 추가) · `answer-key-chunk` · `answer-key-finalize` ·
  `explanations-drain` 신설. 레거시 `import-problem-answer-key` 는 lib 헬퍼 사용으로만
  정리, 동작 불변 (롤백 경로).
- UI: [answer-sheet-uploader.tsx](../../src/components/grade/answer-sheet-uploader.tsx) —
  정오표 오케스트레이션 + 진행률, 원클릭 버튼(시험지+정오표 둘 다 있으면 1단계 버튼이
  「한 번에」로 변신), 정오표 드롭존 선업로드 허용, 진행 중 beforeunload 경고.
- 테스트: `finalizeAnswerKeyItems` 4케이스 추가 (뒤가 이긴다 / 미매칭 버림 / 수 불일치
  throw / 0건 throw).

## 3. 배선 버그 수정 (기존 결함)

재채점 체크박스(`regradeAfterAnswerKey`)가 정오표 요청 body 에 실리지 않아 **체크해도
서버는 항상 재채점 안 함**이었다. 새 경로는 `answer-key-finalize` 에 전달한다.
→ 부작용: 지금까지 "체크했는데 재채점 안 됐던" 사용 기억이 있다면 이게 원인.
이제부터는 체크 시 실제로 재채점이 돌므로 **소요 시간이 늘 수 있다.**

## 4. 부작용 가능 지점

- 원클릭 중 탭 닫힘: beforeunload 경고가 뜨지만 강행하면 진행 중 단계에서 멈춤
  (DB 는 finalize 단위로만 바뀌므로 반쯤 상태 없음). 1단계 완료 후 멈췄다면
  재진입 시 정오표만 따로 반영하면 된다.
- 정오표 드롭존이 시험지 저장 전에도 열림 — 단독 「정오표 반영」 버튼은 여전히
  `problemImported` 게이트 뒤라 순서 실수는 불가능.
- 해설 생성이 정오표 라우트에서 드레인으로 이동 — 레거시 라우트를 직접 쓰는 외부
  경로는 없음 (클라이언트는 새 경로만 사용).
- 마이그레이션 불필요 (전날 JSON MIME 허용이 정오표 스테이징도 커버).

## 5. 수동 확인

- 시험지+정오표 둘 다 올리고 「한 번에」 → 구간 진행률 → 정답 반영 → 해설 카운트 →
  완료. 문항·정답·해설이 그리드에 정상 반영되는지.
- 재채점 체크 후 정오표만 반영 → 학생 점수가 실제로 다시 계산되는지 (수정된 배선).
- 정오표 페이지 수가 3 초과인 경우 청크 2개 이상으로 나뉘어도 정답 병합이 온전한지.
