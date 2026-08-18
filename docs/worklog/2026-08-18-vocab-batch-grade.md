# 2026-08-18 — 단어 시험지 일괄 사진 채점

한 학생씩 사진 채점(15~20초 × N명 대기)이 번거롭다는 문제. 사진을 한 번에 넣고 이름을 자동 매칭한 뒤 병렬로 채점한다.

## 흐름

채점 그리드 상단 「단어 시험지 일괄 채점」 → 다이얼로그
1. 사진 여러 장 드롭/선택 (이미지·PDF)
2. 장당 이름란 판독 (동시 3, 장당 1~2초) → 학생 자동 매칭. 확신도 점: 초록(high) / 노랑(low) / 회색(직접 선택)
3. 매칭 표 확인 — 틀린 건 select 로 고침. 미매칭은 채점 제외, 같은 학생에 2장이면 시작 버튼 잠금
4. 「N명 채점 시작」 → 학생당 별도 요청, 동시 3. 행별 진행/결과(정답수) 실시간
5. 실패 건 재시도 버튼. 완료 후 그리드 점수 즉시 갱신 (updateRow + refetch)

## 파일

- [vocab-batch-grade-dialog.tsx](../../src/components/grade/vocab-batch-grade-dialog.tsx) — 다이얼로그. `runPool` 로 동시 실행 제한
- [grade-grid.tsx](../../src/components/grade/grade-grid.tsx) — 버튼 + 다이얼로그 마운트 (단어 열 있을 때만)
- [vocab-photo-name/route.ts](../../src/app/api/weeks/[id]/vocab-photo-name/route.ts) — 이름 판독 API (재원 학생 명단 조회 → `readVocabSheetName`)
- [anthropic.ts](../../src/lib/anthropic.ts) `readVocabSheetName` — Haiku Vision 이름란 판독 + 명단 매칭

## 설계 결정 (부작용 가능 지점)

- **채점은 학생당 별도 요청** — Vercel Hobby 60초 제한(요청당)에 안전하고, 하나 실패해도 나머지 진행. 서버 API 변경 없음.
- **이름 매칭은 잘못 매칭 < 미매칭** — 자동 매칭 결과를 반드시 강사가 확인하는 단계를 거친다.
  - 명단만 주고 고르게 하면 명단에 없는 이름도 가장 비슷한 학생에 붙이는 걸 실측으로 확인 → 폐기
  - 명단 없이 자유 판독하면 한글 손글씨 오독(김테스트→징혜스트) → 폐기
  - 채택: 명단을 읽기 힌트로 주되 rawName(보이는 그대로)·name(명단 매칭)을 분리 보고. 코드가 정확 일치→high,
    rawName↔name 한 글자 이내→low, 그 외 null. 실측: 명단에 있음→high, 없음→null 정확. 한 글자 차이 이름이 명단에 있으면
    모델이 그쪽으로 읽어 high 가 날 수 있음 — 강사 확인 단계로 흡수 (같은 반에 한 글자 차이 이름은 드묾).
- 결석(present=false) 학생에는 자동 매칭 안 하고 select 에서도 비활성. 이미 채점된 학생이 포함되면 시작 전 덮어쓰기 confirm.
- 다이얼로그 닫힘 초기화는 렌더 중 조정 (set-state-in-effect 규칙). object URL 은 닫힘/언마운트 시 해제.

## 수동 확인

실데이터 필요 (사진 여러 장). 채점 그리드에서 버튼 → 사진 3~5장 → 매칭 표 확인 → 채점 → 행 점수 갱신 → 학생 행 열어 정오표.
실패 케이스: 이름 안 쓴 시험지(미매칭 → 직접 선택), 같은 학생 2장(경고), 네트워크 끊김(실패 → 재시도).

## Vercel 플랜 확인 필요

결제 안 하고 있으면 Hobby → 함수 60초 상한. `maxDuration = 300` 은 무시되지만 무해. 이 설계는 Hobby 에서도 동작.
Pro 인지 확인: Vercel → Team Settings → Billing.
