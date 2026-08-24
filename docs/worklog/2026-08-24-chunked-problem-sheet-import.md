# 2026-08-24 — 문제지형 청크 분리 가져오기 (Vercel 300초 천장 제거)

같은 날 `llm-call-batching.md` 후속. 44p 내신 PDF 실측(641초)으로 "한 함수 300초"에
절대 안 들어가는 문서가 확인되어, 파싱을 **청크당 별도 HTTP 요청**으로 분리했다.

## 구조

```
[브라우저 = 오케스트레이터, 버튼 1회]
  ① POST import-plan      경계 계산 (pdf.js, LLM 0콜, 수 초)
  ② POST import-chunk ×N  청크 1개 파싱 → 스테이징 JSON (동시 4, 요청당 ≤~165초)
  ③ POST import-finalize  스테이징 병합 → 전역 후처리 → DB 저장 → 임시파일 정리
```

- 핵심 불변식: **번호 재배정·지문 전파는 전 청크가 모여야 하므로 finalize 에서만** 실행.
  청크 요청은 원시 결과만 스테이징한다 (`exam-pdf-temp/{원본경로}.chunks/{i}.json`).
- 멱등성: 같은 청크 재요청 = 스테이징 덮어쓰기, finalize 재실행 = 전체 재계산.
  finalize 실패 시 스테이징을 **지우지 않아** 실패 청크만 다시 파싱해 이어갈 수 있다.
- 기존 통짜 라우트(`import-problem-sheet`)는 남겨둠 — 새 경로 문제 시 클라이언트만
  되돌리면 롤백 끝.

파일: [import-plan](../../src/app/api/weeks/[id]/import-plan/route.ts) ·
[import-chunk](../../src/app/api/weeks/[id]/import-chunk/route.ts) ·
[import-finalize](../../src/app/api/weeks/[id]/import-finalize/route.ts) ·
[week-reading-import.ts](../../src/lib/week-reading-import.ts) (`planProblemSheetChunks`
/ `parseProblemSheetChunkForStaging` / `finalizeProblemSheetQuestions`) ·
[answer-sheet-uploader.tsx](../../src/components/grade/answer-sheet-uploader.tsx)

## 실측 (rate limit 재조사 포함)

- 계정은 **Scale 티어** (sonnet ITPM 10M/분) — 어제의 "TPM 병목" 결론은 **오진**.
  동시 6 재실측: 44p가 641.8s → **260.6s (2.5배)**, 스로틀 없음. 동시 3이 안 빨랐던
  건 그날 API 편차. `PDF_PARSE_CONCURRENCY` 2→4, 클라 청크 요청 동시 4.
- E2E (서울여고 13p, 실 sonnet): 계획 3청크 → 병렬 파싱 → finalize 32문항(1~32) 136s.
  통짜 경로와 문항 수 동일.

## 버킷 마이그레이션 (운영 적용 필요)

E2E 가 잡은 버그: `exam-pdf-temp` 버킷이 pdf/이미지 전용이라 스테이징 JSON 업로드 거부.
→ [20260824193000_exam_pdf_temp_allow_json.sql](../../supabase/migrations/20260824193000_exam_pdf_temp_allow_json.sql)
로 `application/json` 허용. **개발 버킷엔 적용 완료, 운영은 배포 전에 SQL Editor 에서
실행해야 한다** — 안 하면 새 경로의 청크 저장이 전부 실패한다 (스테이징 업로드 에러).

## 부작용 가능 지점

- 청크 요청 사이에 사용자가 탭을 닫으면: 이미 뜬 요청은 서버에서 끝까지 돌아 스테이징이
  남지만 finalize 가 안 불려 **DB 반영 없음**. 스테이징 잔여물은 백업 cron 의 30일 정리
  대상이 아니라 임시버킷에 남는다 — 재업로드 시 같은 경로가 아니라 누적됨 (용량 무해,
  추후 정리 로직 후보).
- `parse_answers`(해설지형)·정오표 경로는 이번에 안 건드림 — 여전히 통짜.
- 진행률 UI: `AnswerParseProgress` 에 청크 카운트 모드 추가 — 해설지형(카운트 없음)은
  기존 시간 기반 표시 그대로.

## 수동 확인

- 주차 → 중간·기말 가져오기 → 시험지 PDF 업로드 → "N/M 구간" 진행률 → 완료 후
  문항 목록·지문·선지가 정상인지 (특히 지문 공유 세트 경계).
- 운영 배포 시: **버킷 마이그레이션 SQL 먼저** → 업로드 1회 스모크 테스트.
