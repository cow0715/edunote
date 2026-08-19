# 2026-08-19 — 진단평가 채점지를 인쇄 답안지와 같은 표로 + 객관식 판정 통일 + 문제지 PDF 가져오기 실 테스트로 잡은 버그 2건

## 1. 진단평가 채점지 (채점 그리드 → 시험 셀 슬라이드)

요구: 출제 때 뽑는 **인쇄 답안지**(`answer-sheet/print`, 번호 | 답 표)와 **똑같은 형식**으로 학생 답안 채점지를 세팅.
학생이 쓴 종이를 위에서 아래로 훑으며 그대로 옮겨 적는 흐름이라 행 구성·순서를 1:1 로 맞췄다.

- 파일: [exam-sheet-content.tsx](../../src/components/grade/exam-sheet-content.tsx)
- 표 한 장, 번호 순: **번호 칸(주황, 답안지와 같음) | 답 칸**
  - 객관식 `① ② ③ ④ ⑤ ✓` / 소문항은 답안지처럼 **한 행에 (a) (b) (c) 가로** / O/X 는 `O X 수정어` 인라인 / 서술형·복수는 제자리 입력칸 (아래로 몰지 않음)
  - 학생 답: 정답이면 초록 채움 / 오답이면 빨강 채움 / 정답키 없으면 남색. 정답 후보(복수정답 포함)는 초록 테두리 → 정답키를 따로 안 봐도 됨
  - 무효 「무효」, 전원정답 「전원정답」 배지 (행 오른쪽). 무효는 요약 분모에서도 제외
- 요약 줄 `N정 / M오 / 입력 a/b개` — 단어 정오표와 같은 형식. **저장 전에도 로컬에서 즉시 판정** (예전엔 서버 저장 후에야 ✓✗ 갱신)
- 원본 페이지 이미지는 행마다 인라인으로 펼치지 않고 **아이콘 토글**(회색=저장됨, 노랑=필요하지만 없음). 이게 예전 화면이 길어지던 주범
- `question-inputs.tsx` 에서 `AnswerKey`·`CorrectChip` 만 export 추가. `QuestionRow`/`GroupedQuestionRow` 는 이제 이 화면에선 안 쓰지만 그대로 둠 (다른 화면 영향 0)
- 첫 시도는 2단 columns 였는데 답안지가 1단 세로 표라 눈 흐름이 달라 폐기 → 표 그대로

**갤러리**: `/dev/vocab-print-preview?tab=exam` — 실제 컴포넌트 + 샘플 27문항(소문항·복수정답·전원정답·무효·원본필요·O/X·서술형). `&bare=1` 로 headless 캡처.

## 2. 객관식 판정 규칙 통일 (버그 수정)

[objective-grading.ts](../../src/lib/objective-grading.ts) `gradeObjective(q, studentAnswer)`:
정답 후보 = `correct_answer` + `extra_correct_answers`, `all_correct` 면 답만 있으면 정답, 미입력은 `undefined`.

**고친 버그**: `POST /api/weeks/[id]/grade` (채점 저장) 가 `student_answer === correct_answer` 만 봐서
- 복수정답 문항에서 두 번째 정답을 고른 학생이 **저장할 때마다 오답**으로 기록됨
- 전원정답 문항도 저장하면 원래 정답 기준으로 덮어씀
- 반면 문항 편집 API(`/questions`)의 재채점은 복수정답·전원정답을 인정 → 같은 답이 편집 후엔 정답, 채점 저장 후엔 오답으로 뒤집히던 상태.
이제 두 경로가 같은 함수를 씀. 마이그레이션 없음. **기존에 잘못 저장된 is_correct 는 자동으로 안 바뀜** — 해당 문항의 정답을 편집 화면에서 한 번 저장하면 재채점됨.

## 3. `mapWithConcurrency` 분리 + 테스트

문제지 PDF 청크 병렬 파싱(`02d5de2`)의 핵심 유틸을 [concurrency.ts](../../src/lib/concurrency.ts) 로 빼고 `tests/unit/concurrency.test.ts` 추가 (순서 보존 / 동시 수 상한 / 실패 전파 / concurrency 0 처리). 동작 변화 없음.

## 4. 문제지 PDF 가져오기 — 실 API 테스트로 잡은 것 2건

개발 DB 복구 후 저장된 실제 문제지(`_testweek4.pdf`, 15p, 미래탐구)로 `parseProblemSheetQuestionsOnly` 를 로컬에서 직접 돌림 (DB 쓰기 없음, LLM 과금 있음).

**(1) 지문 속 큰따옴표로 JSON 파싱 실패 → 업로드 전체 실패** (기존 버그, 3회 중 2회 재현)
- 모델이 `"passage": "... told him, "Before receiving ..." He replied, "I can't ..." ..."` 처럼 지문 대화의 따옴표를 이스케이프 안 하고 냄 → jsonrepair 도 `Colon expected` 로 실패 → 청크 실패 → 페이지별 fallback 도 같은 페이지에서 또 실패 → **가져오기 전체가 500**.
- 시도 1: 실패 시 tool_use 로 재요청해 구조 복구 → 모델이 항목을 빠뜨리거나(3개 중 1개만) 원문을 문자열로 통째로 넣음. 폐기.
- 시도 2: 처음부터 strict tool_use 로 받기 → 문항 44·45 누락 + 지문 잘림(출력 286 토큰). **tool_use 는 이 작업에 부적합** — 폐기.
- **채택**: [json-lenient.ts](../../src/lib/json-lenient.ts) `fixUnescapedQuotesInJson` — 문자열 안 `"` 는 뒤에 구조 문자(`:` `}` `]`, 또는 `,` + 다음 값 시작)가 올 때만 닫는 따옴표로 보고 나머지는 `\"` 로. `parseJsonArrayResponse` 가 jsonrepair 실패 시에만 한 번 더 시도 (정상 경로 무변경, 모든 배열 파서 공통). 알려진 한계: `"yes", "no"` 처럼 따옴표 뒤 `, "` 는 구분 못 함 (테스트에 문서화).
- 검증: 실패 청크(13~15p) 3회 → 2회 복구 경로 타고 3회 모두 43·44·45 전부 추출. 15p 전체 → **28문항 18~45, 정렬 OK, 중복 없음, source_page 1~13** (DB 에 저장된 기존 결과와 동일), 150초(동시 2).

**(2) 암호화된 PDF 는 청크 분할에서 크래시**
- 개발 Storage 의 실제 문제지 하나(`_1.pdf`)가 owner-password 암호화 → `PDFDocument.load` 가 throw. 학원 문제지에 흔한 형태.
- `pdf-lib` `load(..., { ignoreEncryption: true })` 로 통일 (week-reading-import 2곳, anthropic 1곳, pdf-extract, dev compare). 인쇄 가능한 owner-lock PDF 는 그대로 읽힘.

**하네스**: `npm run test:api` 18 pass / 1 skip(모의고사 리포트 fixture 없음). 인증 GET 20여 개 라우트(grade, questions, vocab-tests, answer-sheet-html, 페이지들) 200 확인 (매직링크 세션으로 임시 스크립트, 커밋 안 함).

## 부작용 가능 지점

| 변경 | 물릴 수 있는 곳 |
|---|---|
| 채점지 표 (`exam-sheet-content`) | 채점 그리드 → 시험 셀 슬라이드만. OCR 버튼·응시 토글·`updateAnswer/updateAnswerText` 시그니처 그대로. `GroupedQuestionRow` 는 미사용 잔존 |
| 객관식 판정 통일 (`grade` route) | **채점 저장 때마다** 복수정답·전원정답 문항의 `student_answer.is_correct` 가 바뀔 수 있음 → `reading_correct` 재계산 → 학부모 점수·성적표 숫자가 저장 후 달라질 수 있음 (의도된 교정). 기존 잘못 저장분은 다음 저장 또는 정답 편집 때 반영 |
| `fixUnescapedQuotesInJson` | `parseJsonArrayResponse` 를 쓰는 **모든** 배열 파서(문제지·정답표·단어 OCR 등) — 단, jsonrepair 가 실패한 뒤에만 |
| `ignoreEncryption` | 사용자-비밀번호(열기 암호) PDF 는 여전히 실패 — 그건 pdf-lib 한계. owner-lock 만 통과 |
| `mapWithConcurrency` 분리 | 동작 동일. import 경로만 `@/lib/concurrency` |

## 수동 확인
- 채점 그리드 → 아무 학생 시험 셀 → 답안지와 행 순서 같은지, 소문항 가로, O/X·서술형 제자리, 이미지 아이콘 토글
- 복수정답 문항 있는 주차: 두 번째 정답 고른 학생 저장 → ✓ 유지되는지
- 설정 → 해설지 탭 → 문제지 PDF(가능하면 대화 지문 있는 것) 가져오기 → 문항 수·페이지 정상

## 검증
- `npm run check` 초록 (tsc + eslint 0 에러 + 312 tests), `next build` 성공
- 개발 DB 는 처음엔 DNS 미해석(pause) → 사용자가 resume 한 뒤 위 실 API 테스트 진행
