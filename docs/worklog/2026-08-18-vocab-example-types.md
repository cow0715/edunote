# 2026-08-18 — 단어시험 출제 유형 확장 (예문 3종 + 반의어) + OCR 채점 연결

학원 요청 2건: "파생어 대신 반의어", "예문 활용해서 뜻 쓰게 하는 유형". 논의 중에 예문 유형이 3종으로 늘었다.
8/7 백로그(`2026-08-07-backlog-ship.md`)는 아직 미커밋 상태로 그대로 남아 있음 — 커밋 계획에서 분리.

## 새 출제 유형 한눈에

| prompt_source | 인쇄 | 학생이 쓰는 것 | 정답 | 채점 |
|---|---|---|---|---|
| `antonym` | 반의어 단어 | 한글 뜻 | variant.meaning | LLM (기존) |
| `example_meaning` | `The room price (includes) breakfast. ____` | 한글 뜻 | word.correct_answer | LLM (기존) |
| `example` | `The room price _____ breakfast.` | 영어 단어 | 문장 속 표면형 (`includes`) | **코드** (어형 엄격, 철자 1자 관용) |
| `example_choice` | `The room price [ includes / exclude ] breakfast.` | 동그라미 | 원문에 있는 후보 | **코드** (정확 비교) |

`prompt_text`에는 가공된 문장만 저장하고 정답·정답 위치는 저장하지 않는다.
정답은 항상 `vocab_word.example_sentence`(원문)와 `prompt_text`를 비교해 **역산**한다
([vocab-example-blank.ts](../../src/lib/vocab-example-blank.ts) `extractBlankAnswer` / `extractChoiceAnswerIndex`).
**DB 마이그레이션 없음** (text 컬럼 값 추가).

원문이 바뀌면 역산이 어긋나므로 **채점이 시작된 주차는 시험지 변경을 잠근다** (아래 7번). 정답 컬럼을 따로 두는 대신 막는 쪽을 택함 (출제 후 바꾸는 일이 거의 없어서).

## 1. 순수 로직 (`src/lib/`)

- [vocab-example-blank.ts](../../src/lib/vocab-example-blank.ts) — 예문에서 출제 단어 찾기(활용형 -s/-ed/-ing/y→ies/자음중복/구동사 첫 토큰), 빈칸/괄호/선택형 가공, 정답 역산. `~` 포함 구는 매칭 제외.
- [vocab-blank-grading.ts](../../src/lib/vocab-blank-grading.ts) — 빈칸 채점: **어형 엄격**(`abandoned`가 정답이면 `abandon`·`abandons`는 오답 — 문맥에 맞는 형태까지 본다) + **철자 편집거리 1 관용**(`abandomed` 정답). 단 오타가 다른 굴절형과 같아지면(`includes`↔`included`) 어형 오류로 오답, 4자 이하 짧은 단어는 관용 없음. 선택형은 정확 비교. (처음엔 반대 정책이었다가 사용자 결정으로 뒤집음.)
- [vocab-test-ratio.ts](../../src/lib/vocab-test-ratio.ts) — 출제 비율 7종으로 일반화. 기본값 **원본40/유의어20/반의어20/파생어0/예문뜻20/빈칸0/선택0**. 프리셋 "기존 방식"이 예전 50/25/25.
- [clova-layout.ts](../../src/lib/clova-layout.ts) — anthropic.ts 인라인이던 CLOVA 좌표 재구성 분리. **예문 섹션 제목("예문 뜻쓰기/빈칸/선택") y좌표 위는 2단 판정, 아래는 무조건 1단**.
- 유닛테스트 4파일 추가 (예문 가공 34, 비율 9, 채점 13, CLOVA 5).

## 2. 출제 UI ([vocab-word-setup.tsx](../../src/components/grade/vocab-word-setup.tsx))

- 단어별 칩 7개(원본/유의어/반의어/파생어/예문뜻/예문빈칸/예문선택). 예문 칩은 예문이 있고 단어 매칭이 성공한 단어만 활성.
- 비율 패널을 [vocab-source-ratio-panel.tsx](../../src/components/grade/vocab-source-ratio-panel.tsx)로 분리 (분포 바 + 4열 카드). 랜덤 출제는 후보 귀한 순(선택→빈칸→뜻→반의어→파생어→유의어)으로 채우고 나머지 원본.
- 선택형 오답 후보: 반의어 variant → `antonyms` 필드 → 같은 단어장 다른 단어(폴백). 정답 좌우는 출제 시점 랜덤.
- **부작용 가능 지점**:
  - 기본 비율이 바뀌었다 → 랜덤 버튼 누르면 예전과 다른 구성이 나온다. 반의어 없는 단어장은 반의어 20%가 원본으로 채워짐.
  - `fallbackDistractorWords`는 module 변수(렌더 중 대입) — 같은 페이지에 VocabWordSetup이 2개 뜨면 마지막 것 기준.
  - `normalizeSelectedPrompt`는 저장된 예문 `prompt_text`를 그대로 신뢰 → 저장 후 예문을 재생성하면 시험지 텍스트와 원문이 어긋난다 (정답 역산 실패 → english_word 폴백).

## 3. 인쇄 ([vocab-test-print-sheet.tsx](../../src/components/grade/vocab-test-print-sheet.tsx), [vocab-grading-print-sheet.tsx](../../src/components/grade/vocab-grading-print-sheet.tsx))

- 시험지/정답지/클리닉 인쇄를 공용 시트로 통합. A(뜻쓰기 2단) + B/C/D(예문 1단 블록, 있는 것만). 선택형은 시험지·정답지 모두 `[ A / B ]` 텍스트 형식으로 통일 (후보 사이 여백으로 동그라미 공간 확보).
- 예문 파트가 있으면 A파트를 **좌우 균등 분할 + 행 30px**로 압축해 1페이지 우선. 실측: 42문항 안팎까지 1페이지 (30+8, 26+5+5, 24+4+3+3, 32+10 모두 OK / 40+10은 2페이지).
- 섹션 제목 문구("예문 뜻쓰기" 등)는 **OCR 분기점이라 clova-layout.ts 패턴과 반드시 같이 바꿔야** 한다.
- 정답지 인쇄 페이지도 예문 유형 정답 표시(빈칸 밑줄 강조 / 선택형 정답 동그라미).
- **수동 확인**: 정규 시험지 인쇄 → 정답지 보기 → 클리닉 보충 시험지. `/dev/vocab-print-preview`(dev 전용, 로그인 불필요)가 **바뀐 화면 갤러리** — 시험지/정답지(실물)·채점 정오표/학부모 카드/재시험 카드(마크업 재현) 5탭 × 프리셋 5종.

## 4. API

- [vocab-tests/route.ts](../../src/app/api/weeks/[id]/vocab-tests/route.ts) — `prompt_source` 5종 추가 허용. 예문 유형은 variant 없이 저장, `prompt_text` 비면 422. GET에 `example_sentence` 포함.
- [grade-vocab-photo/route.ts](../../src/app/api/weeks/[id]/grade-vocab-photo/route.ts) — 예문 문항의 **인쇄 원문**을 `exampleItems`로 OCR 파서에 전달(정답은 안 넘김 — 판독 편향 방지). 유형별 정답 계산 후 `correctAnswers`. `student_vocab_answer.test_source`에 `example_*` 저장.
- [vocab-answer/route.ts](../../src/app/api/vocab-answer/route.ts) (재채점) — `test_source`가 `example`/`example_choice`면 활성 시험지 `prompt_text`로 정답 역산 → 코드 채점. 나머지는 LLM.
- **부작용 가능 지점**:
  - `gradeVocabPhoto` 시그니처가 위치 인자 → 옵션 객체로 바뀜. 호출부는 grade-vocab-photo 하나뿐 (dev/ocr-test는 프롬프트 함수만 씀).
  - 재채점 정답 역산은 **활성 시험지 기준**. 다만 시험지 재저장 시 구성이 달라지면 (기존 동작대로) 답안이 전부 삭제되고, 같은 구성이면 prompt_text도 같아 역산이 정상 동작한다 — 실제로 물릴 케이스는 거의 없음. 예문선택은 좌우 랜덤이라 재저장하면 항상 "다른 구성" 취급 → 답안 삭제.
  - 원문 변경 리스크는 7번 잠금으로 차단. 참고로 "단어 직접 수정" 저장은 예문을 기존 값 그대로 보존하고, "예문 생성"은 null인 단어만 채우므로 둘 다 출제된 단어의 원문을 못 바꾼다. 파일 재업로드는 원래부터 답안 초기화 동작.
  - 리포트/share/재시험 화면의 예문 문항 표시는 6번 참고.

## 5. OCR/채점 파이프라인 ([anthropic.ts](../../src/lib/anthropic.ts), [prompts.ts](../../src/lib/prompts.ts))

- 파서 프롬프트(CLOVA/Vision 둘 다)에 예문 섹션 규칙 + 인쇄 원문 목록 삽입. 선택형은 "이미지 보고 동그라미·밑줄·체크 인정, 취소선 제외, 둘 다/없음이면 미기재".
- 채점 분기: 빈칸·선택 → 코드, 나머지 → `gradeVocabItems`(LLM). 결과는 번호순 병합.
- **검증 상태**: 프린터 없이 end-to-end 를 돌리기 위해 시험지 인쇄 컴포넌트에 **답 채우기 모드**(`answers` prop, 손글씨풍 폰트 + 선택형 동그라미)를 넣고, 갤러리 `?tab=filled&bare=1` 을 headless Chrome 으로 A4 캡처 → `npm run test:vocab-grade <이미지>` 로 실제 CLOVA+Claude 파이프라인에 투입.
  **결과 (2026-08-18): OCR 34/34, 채점 34/34** — 뜻쓰기 12 + 미기재 12 + 예문뜻 4(정/오/정/미기재) + 빈칸 3(정답/철자1자오류/어형오류) + 선택 3(정/오/정). CLOVA 섹션 분리(예문 y 감지 → 상단 2단, 하단 1단)도 실제 이미지에서 동작 확인. 19초.
  단, 이건 **폰트 손글씨**라 진짜 필기의 흘림·연필 농도·촬영 각도는 미검증. 특히 선택형 동그라미는 예전 실패 이력이 있어 실사진에서 1~2회 튜닝 각오. 이 테스트로 잡은 버그: 빈칸 채점의 굴절형 후보가 가짜 형태(stop→stoped)를 만들어 진짜 오타를 어형 오류로 오판하던 것 → 굴절형 생성 규칙을 실제 영어 형태만 내도록 엄격화.
- 섹션 제목을 OCR이 못 읽으면(흐린 사진) 페이지 전체 2단 판정으로 폴백 → 뜻쓰기 파트는 정상, 예문 파트만 흔들림.

## 6. 채점 결과 · 학부모 · 재시험 화면 (예문 유형 표시)

세 화면 모두 `test_word → 학생답` 한 줄 형식이라 예문 문항이 문맥 없이 단어만 보이던 문제. API가 활성 시험지의 `prompt_text`(`test_prompt`)와 유형별 정답(`test_answer`/`example_answer`)을 같이 내려주고, 화면은 공용 렌더러 [vocab-example-inline.tsx](../../src/components/grade/vocab-example-inline.tsx)로 문장을 그린다.

표시 원칙 (처음엔 유형별 색 뱃지·띠·박스를 썼다가 "난잡하다"는 피드백으로 걷어냄): **문장은 회색, 색은 정오에만** — 정답 초록 / 학생 오답 빨강 취소선 (`ANSWER_RIGHT_CLASS`/`ANSWER_WRONG_CLASS`로 공유). 유형은 문장 형식(괄호/밑줄/`[ ]`)으로 드러나므로 학부모 카드에는 유형 칩을 두지 않는다 (강사 정오표는 파트 제목으로 구분).

| 유형 | 문장 안 표시 |
|---|---|
| 예문뜻 | 괄호 단어만 진하게 |
| 예문빈칸 | 빈칸 자리에 정답을 밑줄로, 틀렸으면 그 뒤에 학생 답 취소선 |
| 예문선택 | `[ A / B ]`에서 정답만 진하게, 학생이 고른 오답 취소선 |

- **강사 채점 정오표** ([grade/route.ts](../../src/app/api/weeks/[id]/grade/route.ts) → [vocab-sheet-content.tsx](../../src/components/grade/vocab-sheet-content.tsx)): **시험지와 같은 순서로 재배치** — 뜻쓰기(2단) → 예문뜻/빈칸/선택 파트(전폭 1단, 문장이 메인 + 오른쪽 고정폭 입력칸). 종이 시험지와 위→아래로 대조 가능. `test_word`는 예문 유형이면 원본 단어로 고정.
- **학부모 share 오답 카드** ([share/[token]/route.ts](../../src/app/api/share/[token]/route.ts) → [share-client.tsx](../../src/app/share/[token]/share-client.tsx)): 카드 뼈대를 유형 무관하게 **[문제 — 시험지 그대로] → 내 답 · 정답** 두 줄로 통일. 빈칸/선택은 문장 속 문제 자리에 **학생이 쓴 답을 그대로 채워**(틀리면 빨강 취소선) 보여주고 정답만 옆에 — 그래서 "내 답" 줄이 따로 없음. 예문 유형은 단어의 뜻도 참고로 한 줄에. **선택형은 두 후보를 뜻과 함께** (`sustain 유지하다 · ~~hinder~~ 방해하다`) — API가 `choice_meanings`로 내려줌 (주차 내 variant·단어에서 영어→뜻 맵, 굴절형은 원형 역산). 유의어·반의어·예문 보조 정보는 그 아래 기존대로.
- **재시험** ([retake/route.ts](../../src/app/api/share/[token]/retake/[weekId]/route.ts) → [retake/page.tsx](../../src/app/share/[token]/retake/[weekId]/page.tsx)): **유형 그대로** 다시 낸다.
  - 뜻/유의어/반의어/예문뜻 → 텍스트(뜻), LLM 채점 (기존)
  - 예문빈칸 → 문장 속 빈칸에 입력값 실시간 표시, 영어 입력, `gradeBlankAnswer`
  - 예문선택 → 후보 2개 버튼 탭, `gradeChoiceAnswer` — 웹이라 동그라미 판독 문제 없음
  - 결과 카드에 문장 + 유형별 정답 표시. 타이머는 유형 무관 10초/문항 유지.
- **부작용 가능 지점**:
  - `test_prompt`/`example_answer`는 **활성 시험지 기준** — 시험지 재저장으로 구성이 바뀌면 답안이 삭제되니 실제로는 안전, 원문 변경 시엔 4번과 같은 폴백.
  - 재시험 API GET 응답 형태가 늘었다(`kind`, `prompt_text`, `choice_options`, `example_answer`). 기존 필드는 그대로라 하위 호환.
  - share `test_word` 계산이 예문 유형에서 바뀌었다 (문장 → 원본 단어). 오답노트 히어로카드 등 `test_word`를 쓰는 다른 곳은 단어명이 나오는 게 오히려 정상.
- **수동 확인**: 예문 유형 포함 주차 채점 → 정오표에 문장 보이는지 / 학부모 링크 오답 카드 / 재시험에서 빈칸·선택 카드 동작.

## 7. 채점 후 시험지 잠금

- [api.ts](../../src/lib/api.ts) `countGradedVocabAnswers` — 주차의 `student_vocab_answer` 개수.
- [vocab-tests/route.ts](../../src/app/api/weeks/[id]/vocab-tests/route.ts) POST: 채점된 답안이 1개라도 있으면 **409** + "이미 채점된 단어 답안이 N개 있어 바꿀 수 없습니다". GET 응답에 `gradedCount` 추가.
- 출제 UI: `gradedCount > 0`이면 "시험지 저장"·"랜덤" 버튼 비활성 + 헤더에 경고. 인쇄·칩 클릭·미리보기는 그대로 (저장만 막힘).
- **부작용 가능 지점**:
  - 시험지를 진짜 바꾸고 싶으면 먼저 그 주차 단어 채점을 지워야 한다 — 지우는 UI는 따로 없음. 필요하면 각 학생 사진 재채점 전에 답안 삭제하는 경로를 만들어야 함. **의도된 불편**.
  - 기존 동작(구성 바뀌면 답안 자동 삭제)은 이제 도달 불가 코드가 됐다 — 잠금이 먼저 걸린다. 코드는 남겨둠 (잠금 해제 시 안전망).
  - `gradedCount`는 출제 UI 로드 시점 값 — 다른 탭에서 채점하면 stale일 수 있으나 서버가 409로 막으니 안전 (토스트로 서버 메시지 표시).
  - `regen-examples`는 null만 채우므로 잠그지 않음. "덮어쓰기" 옵션을 추가하려면 잠금 확인 필요 (코드 주석에 명시).

## 8. 채점 모델 Haiku 전환 + maxDuration

- `VOCAB_GRADING_MODEL` 기본값 **Haiku** (anthropic.ts). 42개 경계 사례(다의어 15·유사어 5·오답 4·품사 4·어미/오타 5·-ing/-ed 4·기타 5) × 3회:
  Sonnet 40/42 · Haiku 39/42, 채점 11.3s → 4.9s. 다의어는 둘 다 15/15. 유일한 차이는 오타 관용(`가셜`→`가설` Haiku 오답), Haiku 는 3회 중 1회 흔들린 문항 1개.
  **롤백**: Vercel 환경변수 `VOCAB_GRADING_MODEL=claude-sonnet-4-6`.
- 두 모델 다 틀린 29·30번(`평가하다`→`평가`, `제한하다`→`제한` 을 오답 처리)은 모델이 아니라 **채점 규칙 문구** 문제 — "하다 생략" 관용 여부를 학원에 확인 필요.
- 시간 측정: 기존형 40문항 25s(OCR 2 + 파싱 12 + 채점 11) / 새 형식 34문항 19s(OCR 2~4 + 파싱 9 + 채점 7). 예문 유형이 느린 게 아니라 원래 그 정도. Haiku 적용 후 학생당 ~15s 예상.
- maxDuration: grade-vocab-photo 60→**300** (Pro 상한, 15명 일괄 병렬 대비), vocab-answer 60→120, retake 60 추가.
- **다음 작업 후보**: 일괄 사진 채점 UI (여러 장 드롭 → 이름 OCR 자동 매칭 + 확인 → 병렬 5개). 15명 × 15s 순차 4분 → 병렬 1분.

## 9. 테스트 도구

- [vocab-print-preview](../../src/app/dev/vocab-print-preview/page.tsx) 갤러리 — 7탭(시험지·**채워진 시험지**·정답지·정오표·학부모 카드·재시험 카드·재시험 결과) × 프리셋 5종. `?tab=<key>&bare=1` 로 컨트롤 없이 시트만 (캡처용). 샘플 데이터·학생 답·기대값은 [sample-data.ts](../../src/app/dev/vocab-print-preview/sample-data.ts).
- [scripts/test-vocab-grade-image.ts](../../scripts/test-vocab-grade-image.ts) (`npm run test:vocab-grade <이미지>`) — 이미지를 실제 `gradeVocabPhoto` 에 넣고 OCR 일치·채점 일치를 기대값과 대조. **실제 LLM/OCR 호출 = 과금**, 사용자 요청 시만.
- 캡처 명령 (Chrome 필요):
  `chrome --headless=new --window-size=794,1123 --force-device-scale-factor=2 --virtual-time-budget=8000 --screenshot=out.png "http://localhost:3000/dev/vocab-print-preview?tab=filled&bare=1"`

## 10. 기타

- [proxy.ts](../../src/proxy.ts): `/dev/vocab-print-preview`를 `NODE_ENV=development`에서만 공개 경로로. 운영에선 기존처럼 로그인 필요.
- vocab-word-setup에서 `SlidersHorizontal` import 제거(패널로 이동).

## 롤백

- 코드만 되돌리면 된다 (마이그레이션 없음). 이미 저장된 `prompt_source='example*'`/`'antonym'` 시험지 행은 되돌린 코드에서 `word`로 취급됨 → 시험지 다시 저장하면 정리.
