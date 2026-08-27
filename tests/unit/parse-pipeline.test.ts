import { describe, it, expect, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { runParsePipeline, type PipelineFile } from '../../src/lib/llm/pipeline'

async function makePdfBase64(pageCount: number): Promise<string> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i += 1) doc.addPage([200, 200])
  return Buffer.from(await doc.save()).toString('base64')
}

// ── 엔진 (whole / single-page — 남은 입력 분할 정책) ─────────────────────────

describe('runParsePipeline', () => {
  const img = (name: string): PipelineFile => ({ fileData: 'x', mimeType: 'image/png', fileName: name })

  it('whole: 파일마다 1회 파싱하고 병합 → 후처리 체인 순서대로 → finalize', async () => {
    const parseChunk = vi.fn(async (file: PipelineFile): Promise<{ question_number: number; src?: string; step?: string }[]> => [{ question_number: 1, src: file.fileName }])
    const result = await runParsePipeline({
      label: 't',
      chunk: { kind: 'whole' },
      parseChunk,
      postProcess: [
        (items) => items.map((q) => ({ ...q, step: 'a' })),
        (items) => items.map((q) => ({ ...q, step: q.step + 'b' })),
      ],
      finalize: (items) => items.map((q) => q.step),
    }, [img('f1'), img('f2')])

    expect(parseChunk).toHaveBeenCalledTimes(2)
    expect(result.items).toEqual(['ab', 'ab'])
    expect(result.chunkCount).toBe(2)
  })

  it('single-page: PDF 를 페이지로 쪼개고 normalizeChunk 에 원본 기준 pageOffset 을 넘긴다', async () => {
    const offsets: number[] = []
    const result = await runParsePipeline({
      label: 't',
      chunk: { kind: 'single-page' },
      parseChunk: async () => [{ n: 1 }],
      normalizeChunk: (items, file) => { offsets.push(file.pageOffset ?? -1); return items },
      finalize: (items) => items,
    }, [{ fileData: await makePdfBase64(3), mimeType: 'application/pdf' }])

    expect(result.chunkCount).toBe(3)
    expect(offsets).toEqual([0, 1, 2])
  })

  it('skipIf: 판별에 걸린 청크만 건너뛰고 순번을 보고한다 (content filter 페이지)', async () => {
    const result = await runParsePipeline({
      label: 't',
      chunk: { kind: 'whole' },
      onChunkError: { skipIf: (e) => e instanceof Error && e.message.includes('filtered') },
      parseChunk: async (file) => {
        if (file.fileName === 'f2') throw new Error('Output blocked: filtered')
        return [{ src: file.fileName }]
      },
      finalize: (items) => items,
    }, [img('f1'), img('f2'), img('f3')])

    expect(result.items.map((q) => q.src)).toEqual(['f1', 'f3'])
    expect(result.skippedChunks).toEqual([2])
  })

  // 사용자에게 "3쪽 건너뜀" 으로 보여주므로 single-page 정책에서 skippedChunks 가 실제 페이지 번호와 같아야 한다.
  it('single-page + skipIf: 필터에 걸린 페이지만 버리고 그 페이지 번호를 보고한다', async () => {
    const result = await runParsePipeline({
      label: 't',
      chunk: { kind: 'single-page' },
      onChunkError: { skipIf: (e) => e instanceof Error && e.message.includes('filtered') },
      parseChunk: async (file) => {
        const page = (file.pageOffset ?? 0) + 1
        if (page === 3) throw new Error('Output blocked: filtered')
        return [{ page }]
      },
      finalize: (items) => items,
    }, [{ fileData: await makePdfBase64(5), mimeType: 'application/pdf' }])

    expect(result.items.map((q) => q.page)).toEqual([1, 2, 4, 5])
    expect(result.skippedChunks).toEqual([3])
  })

  it('skip 된 청크 다음 항목은 resetIndices 로 표시된다 (연속성 가정 차단 지점)', async () => {
    let ctxSeen: { skipped: unknown[]; resetIndices: Set<number> } | null = null
    await runParsePipeline({
      label: 't',
      chunk: { kind: 'single-page' },
      onChunkError: { skipIf: (e) => e instanceof Error && e.message.includes('filtered') },
      parseChunk: async (file) => {
        const page = (file.pageOffset ?? 0) + 1
        if (page === 2) throw new Error('Output blocked: filtered')
        return [{ page }]
      },
      postProcess: [(items, ctx) => { ctxSeen = ctx; return items }],
      finalize: (items) => items,
    }, [{ fileData: await makePdfBase64(3), mimeType: 'application/pdf' }])

    // 3쪽 항목(병합 인덱스 1)은 2쪽 결손 직후 — 연속성 리셋 지점
    expect(ctxSeen!.resetIndices.has(1)).toBe(true)
  })

  it('skipIf 에 안 걸리는 에러는 그대로 던진다', async () => {
    await expect(runParsePipeline({
      label: 't',
      chunk: { kind: 'whole' },
      onChunkError: { skipIf: () => false },
      parseChunk: async () => { throw new Error('boom') },
      finalize: (items) => items,
    }, [img('f1')])).rejects.toThrow('boom')
  })
})
