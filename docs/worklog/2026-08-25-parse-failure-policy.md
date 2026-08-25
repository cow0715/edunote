# 2026-08-25 — 파싱 파이프라인 실패 정책 통일

문항 파싱 LLM 호출 8곳의 제각각인 실패 처리(재시도/부분 저장/보고)를 공통 메커니즘으로
통일. 행동은 도메인별로 다르게 유지 (아래 표).

## 1. 엔진 — `onChunkError` 조합형 ([pipeline.ts](../../src/lib/llm/pipeline.ts))

```ts
onChunkError?: 'throw' | 'retry-per-page'   // 기존 축약형 하위호환
  | { retryPerPage?: boolean; skipIf?: (e) => boolean }
```

- **판별 순서**: skipIf(콘텐츠 필터 = 결정적) → **재시도 없이 즉시 skip** (재시도는 과금,
  필터는 다시 해도 걸림). retryPerPage 는 출력 문제(JSON 깨짐)용 — 페이지 단위 재시도,
  재시도 중 실패 페이지도 skipIf 통과 시 그 페이지만 skip. 네트워크성 429/529 는 SDK 가
  기본 2회 재시도하므로 여기선 중복 재시도 안 함.
- 결과에 `skipped: {chunkIndex, startPage, endPage, reason}[]` 추가 (기존 `skippedChunks`
  유지). `PipelineFile.pageCount` 를 분할 시 채워 페이지 범위를 계산.

## 2. 후처리 skip 가드 — 조용한 데이터 오염 방지 ([postprocess.ts](../../src/lib/llm/postprocess.ts))

파이프라인이 postProcess 체인에 `ctx: {skipped, resetIndices}` 를 넘긴다.
resetIndices = 병합 배열에서 "직전에 결손이 있는" 항목 인덱스 (청크 전체 skip 은 다음
청크 첫 항목, 페이지 skip 은 그 지점 다음 항목 — 청크 끝 skip 은 다음 청크로 이월).

- `propagateSharedPassage`: reset 지점에서 직전 지문을 버림 — **skip 된 지문이 "윗글"
  문항에 엉뚱하게 붙는 것 방지** (가드 유무 대비 테스트 있음).
- `renumberDuplicateQuestions`: 결손이 있으면 재배정 번호를 **리스트 전체 최대 번호
  다음**부터만 — 결손 직후 무번호 문항이 skip 된 번호를 도용하지 않게. 이 작업 중 발견:
  기존 fallback("직전 배정 다음")도 결손 직후 무번호에서 도용이 실제로 일어났다.

## 3. 호출처 정책 적용

| 호출처 | 적용 |
|---|---|
| 문제지형 legacy + 청크 라우트 | `PARSE_FAILURE_POLICY = {retryPerPage, skipIf:필터}` 공통 상수. skipped 를 응답으로 |
| 기출은행 | 기존 2단(whole→single-page) 구조 유지, 페이지 모드 **동시 4** (순차라 44p급 300초 초과 위험이었음) |
| 해설지형 (parse-answers) | whole 1청크 + skipIf — 필터로 통째 막히면 빈 결과 → 422. `skipped_pages` 응답 추가 |
| 정오표 legacy | skipIf 추가 — skip 시 정답 수 부족 → **수 검증이 부분 반영을 막음** (의도) |
| 답안 OCR·OMR | **범위 제외** (스펙 합의) — 빠진 페이지 = 학생 전원 오답이라 부분 저장 UX 는 별도 판단 필요 |

## 4. 응답·UI 계약

- 파싱 응답 공통: `skipped_pages: number[]` (import-problem-sheet · import-chunk ·
  import-finalize · parse-answers · 기출은행은 기존 그대로).
- 스테이징 JSON 형식 변경: `items[]` → `{items, skipped}` (finalize 는 양쪽 다 읽음).
- 클라 오케스트레이터 ([answer-sheet-uploader.tsx](../../src/components/grade/answer-sheet-uploader.tsx)):
  문제지형 청크가 재시도까지 실패하면 **모아서 계속 진행** → finalize 에
  `failedChunkIndexes` 전달(그 범위 비운 채 저장 + 결손 경계 가드) → 완료 메시지·토스트에
  "N~M쪽은 인식하지 못했습니다" 표시. 전 청크 실패 시에만 에러.
- 정오표 청크는 실패 시 기존대로 중단 — 부분 정답 반영은 finalize 수 검증이 어차피
  거부하므로 이어가면 과금 낭비.

## 부작용 가능 지점

- 스테이징 형식 변경: 배포 전 스테이징 잔여물(구 형식)이 있어도 finalize 가 배열 형식을
  그대로 읽으므로 호환. 신규 형식은 마이그레이션 불필요 (같은 JSON MIME).
- skip 발생 시 문항 번호에 공백이 생긴다 — 그리드에서 "8~14번 없음"으로 보이는 게 정상
  (조용히 이어붙이지 않는 것이 의도).
- 기출은행 동시 4: TPM 은 Scale 티어라 여유 (실측 근거 주석 참조).

## 수동 확인

- 문제지형 업로드 중 일부 구간 실패 시나리오: 완료 메시지에 결손 범위 표시 + 나머지
  문항은 저장되는지. 재업로드 시 결손 문항이 채워지는지 (같은 키 upsert).
- 기출은행 필터 걸린 PDF: "N쪽 건너뜀" 토스트 기존 동작 유지 + 페이지 모드 속도 개선.
