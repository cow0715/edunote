/**
 * 문서 파싱 파이프라인 엔진 (입력 분할형).
 *
 *   입력 파일들 → ① 청크 정책으로 분할 → ② 청크마다 LLM 파싱(도메인 함수) → ③ 병합 + 공용 후처리 → ④ 도메인 출력 변환
 *
 * 남은 사용처: 주차 해설지 통짜 폴백(whole), 모의고사 OCR/OMR(single-page).
 * 문서 본문 파싱의 기본 경로는 llm/ranged.ts 의 출력 범위 분할이다 — pages 청킹(경계 정렬·
 * 페이지 재시도)은 그쪽으로 대체되어 2026-08-27 제거됐다.
 * 저장(④ 이후)은 도메인 라우트가 담당한다.
 */

import { mapWithConcurrency } from '../concurrency'
import { splitPdfToSinglePageBase64 } from '../pdf'

export type PipelineFile = {
  fileData: string
  mimeType: string
  fileName?: string
  /** 원본 문서 기준 이 조각의 시작 페이지 (0-base). 청크 분할 시 엔진이 채운다 */
  pageOffset?: number
  /** 이 조각의 페이지 수. 엔진이 분할 시 채운다 (as-is/whole 은 미상) */
  pageCount?: number
}

export type ChunkPolicy =
  /** 문서 통째로 1회 (주차 통짜 폴백) */
  | { kind: 'whole' }
  /** 1페이지씩 (OMR·답안지 OCR) */
  | { kind: 'single-page' }

export type ChunkErrorPolicy =
  /** 즉시 실패 */
  | 'throw'
  /**
   * skipIf 에 걸리는 에러(콘텐츠 필터 = 결정적)는 재시도 없이 즉시 skip — 재시도는 과금이고
   * 필터는 다시 해도 걸린다. 아니면 throw. 네트워크성 429/529 는 SDK 가 기본 2회 재시도한다.
   */
  | { skipIf?: (error: unknown) => boolean }

/** skip 된 범위 기록. 페이지 번호는 1-base, endPage 는 범위를 모르면 null */
export type SkippedRange = {
  chunkIndex: number
  startPage: number
  endPage: number | null
  reason: string
}

/** postProcess 단계에 전달되는 문맥 — skip 으로 생긴 공백을 후처리가 알게 한다 */
export type PostProcessContext = {
  /** skip 된 범위들 (비어 있으면 결손 없음) */
  skipped: SkippedRange[]
  /** 병합 배열에서 "직전에 결손이 있는" 항목의 인덱스 — 지문 전파 등 연속성 가정은 여기서 끊어야 한다 */
  resetIndices: Set<number>
}

export type ParsePipelineSpec<TRaw, TOut> = {
  /** 로그 라벨 */
  label: string
  chunk: ChunkPolicy
  /** 청크 동시 처리 수 (기본 1). rate limit 예산과 맞바꾸는 값 */
  concurrency?: number
  onChunkError?: ChunkErrorPolicy
  /** 청크 1개 → LLM 파싱 (도메인 함수 그대로) */
  parseChunk: (file: PipelineFile) => Promise<TRaw[]>
  /** 청크 단위 보정 (페이지 오프셋 반영 등). 병합 전에 실행 */
  normalizeChunk?: (items: TRaw[], file: PipelineFile) => TRaw[]
  /** 병합 후 공용 후처리 체인 (번호 재배정, 지문 전파 …). 순서대로 적용. ctx 로 skip 공백을 받는다 */
  postProcess?: Array<(items: TRaw[], ctx: PostProcessContext) => TRaw[]>
  /** 도메인 출력으로 변환 */
  finalize: (items: TRaw[]) => TOut[]
}

export type ParsePipelineResult<TOut> = {
  items: TOut[]
  chunkCount: number
  /** skipIf 정책으로 건너뛴 청크의 순번 (1-base, 처리 순서 기준). 페이지 단위 skip 은 미포함 — skipped 참고 */
  skippedChunks: number[]
  /** skip 된 범위 상세 (청크 전체 + 재시도 중 페이지 단위 포함) */
  skipped: SkippedRange[]
}

async function splitFile(file: PipelineFile, policy: ChunkPolicy): Promise<PipelineFile[]> {
  const baseOffset = file.pageOffset ?? 0
  const asIs = [{ ...file, pageOffset: baseOffset }]
  if (policy.kind === 'whole' || file.mimeType !== 'application/pdf' || !file.fileData) return asIs

  const label = (start: number, end: number) =>
    file.fileName ? `${file.fileName}#p${start + 1}-${end}` : `chunk-p${start + 1}-${end}.pdf`

  const pages = await splitPdfToSinglePageBase64(file.fileData)
  if (pages.length <= 1) return asIs
  return pages.map((fileData, index) => ({
    fileData, mimeType: 'application/pdf', fileName: label(index, index + 1), pageOffset: baseOffset + index, pageCount: 1,
  }))
}

export async function runParsePipeline<TRaw, TOut>(
  spec: ParsePipelineSpec<TRaw, TOut>,
  files: PipelineFile[],
): Promise<ParsePipelineResult<TOut>> {
  const { label, concurrency = 1, onChunkError = 'throw' } = spec
  const normalize = spec.normalizeChunk ?? ((items: TRaw[]) => items)

  const chunks: PipelineFile[] = []
  for (const file of files) chunks.push(...await splitFile(file, spec.chunk))
  if (chunks.length > 1) console.log(`[${label}] ${files.length}개 파일 → ${chunks.length}개 청크`)

  // 문자열 축약형을 조합형으로 정규화 (하위호환)
  const policy: { skipIf?: (error: unknown) => boolean } =
    onChunkError === 'throw' ? {} : onChunkError

  const skippedChunks: number[] = []
  const skipped: SkippedRange[] = []

  const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

  const parseOne = async (chunk: PipelineFile, index: number): Promise<TRaw[]> => {
    if (!chunk.fileData) throw new Error('업로드 파일 데이터를 읽지 못했습니다.')
    const chunkStartPage = (chunk.pageOffset ?? 0) + 1
    const chunkEndPage = chunk.pageCount ? (chunk.pageOffset ?? 0) + chunk.pageCount : null
    try {
      return normalize(await spec.parseChunk(chunk), chunk)
    } catch (error) {
      // 결정적 에러(콘텐츠 필터 등)는 재시도 없이 즉시 skip — 재시도는 과금이고 결과가 안 바뀐다
      if (policy.skipIf?.(error)) {
        console.warn(`[${label}] 청크 ${index + 1} 건너뜀 (${chunk.fileName ?? '?'}):`, errorText(error))
        skippedChunks.push(index + 1)
        skipped.push({ chunkIndex: index + 1, startPage: chunkStartPage, endPage: chunkEndPage, reason: errorText(error) })
        return []
      }
      throw error
    }
  }

  const groups = await mapWithConcurrency(chunks, concurrency, parseOne)

  // 병합 배열 기준 "직전에 결손이 있는" 항목 인덱스 (skip 된 청크의 다음 항목)
  const resetIndices = new Set<number>()
  let offset = 0
  let pendingReset = false
  groups.forEach((group, groupIndex) => {
    const chunkWasSkipped = skipped.some((entry) => entry.chunkIndex === groupIndex + 1)
    if (pendingReset && group.length > 0) {
      resetIndices.add(offset)
      pendingReset = false
    }
    offset += group.length
    if (chunkWasSkipped && group.length === 0) pendingReset = true
  })

  const ctx: PostProcessContext = { skipped, resetIndices }
  let merged = groups.flat()
  for (const step of spec.postProcess ?? []) merged = step(merged, ctx)

  return {
    items: spec.finalize(merged),
    chunkCount: chunks.length,
    skippedChunks: skippedChunks.sort((a, b) => a - b),
    skipped,
  }
}
