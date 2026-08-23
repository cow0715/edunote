/**
 * 문서 파싱 파이프라인 엔진.
 *
 *   입력 파일들 → ① 청크 정책으로 분할 → ② 청크마다 LLM 파싱(도메인 함수) → ③ 병합 + 공용 후처리 → ④ 도메인 출력 변환
 *
 * 해설지형·문제지형·기출은행·모의고사가 모두 같은 엔진을 타고, 차이는 스펙(정책·프롬프트·후처리 조합)으로만 표현한다.
 * 저장(④ 이후)은 도메인 라우트가 담당한다.
 */

import { mapWithConcurrency } from '../concurrency'
import {
  getPdfPageTexts, pageStartsWithQuestion, planAlignedPageChunks,
  splitPdfByRangesBase64, splitPdfIntoChunksBase64, splitPdfToSinglePageBase64,
} from '../pdf'

export type PipelineFile = {
  fileData: string
  mimeType: string
  fileName?: string
  /** 원본 문서 기준 이 조각의 시작 페이지 (0-base). 청크 분할 시 엔진이 채운다 */
  pageOffset?: number
}

export type ChunkPolicy =
  /** 문서 통째로 1회 (해설지형·기출) */
  | { kind: 'whole' }
  /** n페이지씩. alignToQuestionStart 면 다음 페이지가 문항으로 시작할 때만 자른다 (지문 분리 방지) */
  | { kind: 'pages'; pagesPerChunk: number; alignToQuestionStart?: boolean; maxPagesPerChunk?: number }
  /** 1페이지씩 (OMR·답안지 OCR) */
  | { kind: 'single-page' }

export type ChunkErrorPolicy =
  /** 즉시 실패 */
  | 'throw'
  /** 실패한 청크만 1페이지 단위로 다시 시도, 그래도 실패하면 throw */
  | 'retry-per-page'
  /** 판별 함수가 true 면 그 청크만 건너뛰고 계속 (content filter 등) */
  | { skipIf: (error: unknown) => boolean }

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
  /** 병합 후 공용 후처리 체인 (번호 재배정, 지문 전파 …). 순서대로 적용 */
  postProcess?: Array<(items: TRaw[]) => TRaw[]>
  /** 도메인 출력으로 변환 */
  finalize: (items: TRaw[]) => TOut[]
}

export type ParsePipelineResult<TOut> = {
  items: TOut[]
  chunkCount: number
  /** skipIf 정책으로 건너뛴 청크의 순번 (1-base, 처리 순서 기준) */
  skippedChunks: number[]
}

async function splitFile(file: PipelineFile, policy: ChunkPolicy): Promise<PipelineFile[]> {
  const baseOffset = file.pageOffset ?? 0
  const asIs = [{ ...file, pageOffset: baseOffset }]
  if (policy.kind === 'whole' || file.mimeType !== 'application/pdf' || !file.fileData) return asIs

  const label = (start: number, end: number) =>
    file.fileName ? `${file.fileName}#p${start + 1}-${end}` : `chunk-p${start + 1}-${end}.pdf`

  if (policy.kind === 'single-page') {
    const pages = await splitPdfToSinglePageBase64(file.fileData)
    if (pages.length <= 1) return asIs
    return pages.map((fileData, index) => ({
      fileData, mimeType: 'application/pdf', fileName: label(index, index + 1), pageOffset: baseOffset + index,
    }))
  }

  let chunks
  if (policy.alignToQuestionStart) {
    const pageTexts = await getPdfPageTexts(file.fileData).catch(() => null)
    if (pageTexts && pageTexts.length > policy.pagesPerChunk) {
      const ranges = planAlignedPageChunks(pageTexts.map(pageStartsWithQuestion), policy.pagesPerChunk, policy.maxPagesPerChunk)
      chunks = await splitPdfByRangesBase64(file.fileData, ranges)
    }
  }
  chunks ??= await splitPdfIntoChunksBase64(file.fileData, policy.pagesPerChunk)

  if (chunks.length === 1) return asIs
  return chunks.map((chunk) => ({
    fileData: chunk.fileData,
    mimeType: 'application/pdf',
    fileName: label(chunk.startPage, chunk.endPage),
    pageOffset: baseOffset + chunk.startPage,
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

  const skippedChunks: number[] = []

  const parseOne = async (chunk: PipelineFile, index: number): Promise<TRaw[]> => {
    if (!chunk.fileData) throw new Error('업로드 파일 데이터를 읽지 못했습니다.')
    try {
      return normalize(await spec.parseChunk(chunk), chunk)
    } catch (error) {
      if (typeof onChunkError === 'object' && onChunkError.skipIf(error)) {
        console.warn(`[${label}] 청크 ${index + 1} 건너뜀 (${chunk.fileName ?? '?'}):`, error instanceof Error ? error.message : error)
        skippedChunks.push(index + 1)
        return []
      }
      if (onChunkError === 'retry-per-page' && chunk.mimeType === 'application/pdf') {
        const pages = await splitFile(chunk, { kind: 'single-page' })
        if (pages.length > 1) {
          console.warn(`[${label}] 청크 파싱 실패 → 페이지 단위 재시도:`, error instanceof Error ? error.message : error)
          const collected: TRaw[] = []
          for (const page of pages) collected.push(...normalize(await spec.parseChunk(page), page))
          return collected
        }
      }
      throw error
    }
  }

  const groups = await mapWithConcurrency(chunks, concurrency, parseOne)
  let merged = groups.flat()
  for (const step of spec.postProcess ?? []) merged = step(merged)

  return { items: spec.finalize(merged), chunkCount: chunks.length, skippedChunks: skippedChunks.sort((a, b) => a - b) }
}
