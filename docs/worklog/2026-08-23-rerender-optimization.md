# 2026-08-23 — 리렌더 최적화: React Compiler 도입 + 공유 페이지/단어 세팅/기출 은행 memo 분리

측정은 전부 dev 모드·개발 DB(단어 68개, 5주차) 기준 "입력 → 화면 반영" ms. 운영 데이터(1600단어·25주차)에선 절대값 차이가 더 크다.

## 1. 인프라 — React Compiler + Query 포커스 재검증 끄기

- [next.config.ts](../../next.config.ts) `reactCompiler: true` + `babel-plugin-react-compiler` devDependency. 컴포넌트/훅을 자동 memo.
- [query-provider.tsx](../../src/components/providers/query-provider.tsx) `refetchOnWindowFocus: false`. 탭 복귀마다 공유 페이지 같은 큰 쿼리가 다시 내려와 전체 리렌더되던 것을 막음. 강사 1명이 편집하는 구조라 포커스 재검증 없이도 어긋날 일이 거의 없다고 판단.

**부작용 가능 지점**
- 컴파일러는 **조용히 건너뛴다**: `try/finally`, try 안의 `?.`/`??`/throw, 렌더 중 모듈 변수·`ref.current` 대입, 핸들러 `function` 선언이 아래쪽 `useMemo` 값을 호이스팅 참조 → 그 컴포넌트만 최적화 제외(린트엔 안 뜸). 현재 약 35개 컴포넌트가 이 이유로 스킵 중(대부분 `setLoading(true) … finally setLoading(false)`). 스캔: babel 플러그인 logger 로 `CompileError` 이벤트 수집.
- 컴파일되기 시작한 컴포넌트는 **새 린트 에러가 드러난다** (`set-state-in-effect`, `purity` 등). 스킵 해제 작업은 린트 정리를 동반한다.
- `refetchOnWindowFocus: false` — 다른 기기/탭에서 고친 데이터가 돌아왔을 때 자동으로 안 바뀜. 새로고침하거나 mutation 이 invalidate 해야 반영.
- `react-hook-form` `watch()` 쓰는 `student-form-dialog` 는 라이브러리 비호환으로 영구 스킵 (경고 1개 추가, 무해).

## 2. 공유 페이지 `share/[token]/share-client.tsx`

파생 데이터(점수 모델·출결·차트·분석·단어장 필터 등) 전부 `useMemo`, `VocabStudyWordCard` memo, 검색어는 `useDeferredValue` 로 1600개 필터링만 지연. 테마 토글(최상위 state) 기준 탭별 14~55% 단축. 탭 전환은 마운트라 변화 없음(정상).

**부작용** — `data` 없을 때도 참조가 안정된 빈 값을 쓰도록 했음. 계산 로직 자체는 안 바꿈. 검색 결과가 타이핑보다 한 박자 늦게 따라오는 건 의도.

## 3. 단어 세팅 `vocab-word-setup.tsx` (가장 큰 변경)

시작 시점 1.1~1.3초/조작 → **30~80ms**. 세 단계:

1. `getPromptOptions` WeakMap 캐시 (단어장 전체 스캔 O(N²~N³) 제거), `candidateCounts` useMemo. [vocab-choice-distractor.ts](../../src/lib/vocab-choice-distractor.ts) 도 `find` → Map.
2. `WordRow` / `PreviewRow` memo 분리. 미리보기(선택 30개 × select) 가 렌더당 120ms 였음. 콜백 4개는 `useRef` + 고정 `useCallback` 래퍼.
3. 컴파일러가 이 컴포넌트를 스킵하던 원인 5개 제거 → `try/finally`·`try/catch` 를 모듈 헬퍼 `runWithLoading` / `runOrReport` 로, 모듈 변수 대입 → `setFallbackDistractorWords()`, ref 갱신 → `useEffect`, 파생값 블록을 핸들러 선언 위로 이동, `Date.now()` → `makeClinicPrintStamp()`.

```
VocabWordSetup (compiled)
 ├ state → 파생값(useMemo) → 핸들러 function 들 → rowHandlersRef(useEffect 갱신)
 ├ WordRow ×68 (memo)   props: isSelected / selectedSource / orderNo (원시값)
 └ PreviewRow ×30 (memo) props: prompt (selectedPrompts[id] 참조 그대로)
```

**부작용 가능 지점**
- **저장본 동기화가 effect → 렌더 중 조정으로 바뀜.** 이제 스토어 `savedWords` **참조가 바뀔 때만** `editWords` 를 덮어씀. 예전엔 status 변경 시에도 덮었음. 저장 시엔 `setVocabSaved` 가 참조를 바꾸므로 실질 차이 없다고 판단했으나, 저장본이 같은 참조로 유지된 채 status 만 바뀌는 경로가 있다면 편집본이 남는다.
- 행 핸들러가 ref 경유 — effect 커밋 전(같은 프레임)에 클릭이 오면 직전 렌더의 핸들러가 실행. 실사용에선 발생하지 않는 타이밍.
- `runWithLoading` 은 실패 시 `false` 반환. 랜덤 출제/클리닉 인쇄는 `if (!ok) return` 으로 이전의 `catch { return }` 과 동일하게 중단.
- 엑셀 업로드(`handleUpload`)/저장(`saveWords`) 의 에러 처리는 `runOrReport` 로 옮겼을 뿐 메시지·status 전이 동일.
- 영향 화면: 주차 설정 다이얼로그 "단어 세팅" 탭, 클리닉 시험지 인쇄, 랜덤 출제.

**수동 확인** — 단어 세팅 탭 열기(68개 표시·미리보기 문항 수), 체크/칩/개수/검색, 랜덤 출제, 시험지 저장, 엑셀 다시 올리기.

## 4. 기출문제 은행 `exam-bank/page.tsx` + 학생 현황 + 문항 편집기

- `QuestionCard` memo + `onToggleSelect(id)` 안정 콜백(선택은 Set 대신 boolean 으로 내려줌). 무한스크롤 150개 이상에서 체크 하나에 전부 리렌더되던 것 제거. `ExamList`/`QuestionCard` 의 `try/finally` 를 `useMutation` 으로 바꿔 컴파일러 활성화. `MarkdownText` 파싱 useMemo.
- [analysis/page.tsx](../../src/app/(admin)/analysis/page.tsx): Recharts 스파크라인 → 순수 SVG(d3 monotone 보간 동일 구현, 툴팁 대신 `<title>`), `StudentRow` memo 분리, 파생값 useMemo. 개발 DB 학생 2명이라 **실측 못 함**.
- [question-type-editor.tsx](../../src/components/grade/question-type-editor.tsx): 스냅샷 fingerprint useMemo.

**부작용** — 스파크라인 hover 툴팁이 브라우저 기본 title 툴팁으로 바뀜(디자인 변화). AI 해설 생성 버튼은 `useMutation` 이라 **한 번에 하나만 진행 중 표시**(`variables` 기준) — 예전 `generatingId` 와 동일 동작. 해설 저장 실패 시 편집 모드 유지(동일).

## 검증
`npm run check` 0 에러 / 경고 30(시작 시점과 동일) / 341 테스트. 컴파일러 스캔으로 `VocabWordSetup`·`WordRow`·`PreviewRow`·`ExamList`·`QuestionCard` 컴파일 확인.

## 다음 후보
남은 스킵 컴포넌트 ~35개 (`try/finally` 패턴 27개) → `useMutation` 또는 `runWithLoading` 로 기계적 전환. 우선순위: clinic, dashboard/[classId], students.
