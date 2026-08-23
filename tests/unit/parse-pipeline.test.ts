import { describe, it, expect, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { planAlignedPageChunks, pageStartsWithQuestion } from '../../src/lib/pdf'
import { renumberDuplicateQuestions, propagateSharedPassage } from '../../src/lib/llm/postprocess'
import { runParsePipeline, type PipelineFile } from '../../src/lib/llm/pipeline'

async function makePdfBase64(pageCount: number): Promise<string> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i += 1) doc.addPage([200, 200])
  return Buffer.from(await doc.save()).toString('base64')
}

// ── 청크 경계 계획 ──────────────────────────────────────────────────────────

describe('pageStartsWithQuestion', () => {
  it('"1." / "12)" / "[6~7]" 로 시작하면 문항 시작', () => {
    expect(pageStartsWithQuestion('1. 다음 글의 제목은?')).toBe(true)
    expect(pageStartsWithQuestion('  12) 밑줄 친')).toBe(true)
    expect(pageStartsWithQuestion('[6~7] 다음 글을 읽고')).toBe(true)
  })
  it('지문 중간 문장으로 시작하면 아님', () => {
    expect(pageStartsWithQuestion('and the results were consistent with')).toBe(false)
    expect(pageStartsWithQuestion('')).toBe(false)
  })
})

describe('planAlignedPageChunks', () => {
  it('경계가 전부 안전하면 n장씩 정확히 자른다', () => {
    const starts = [true, true, true, true, true, true]
    expect(planAlignedPageChunks(starts, 3)).toEqual([{ startPage: 0, endPage: 3 }, { startPage: 3, endPage: 6 }])
  })

  it('자르려는 다음 페이지가 문항 시작이 아니면 청크를 늘려 안전한 경계까지 간다 (지문이 4쪽으로 넘어가는 경우)', () => {
    //          p1    p2    p3    p4(지문 이어짐) p5    p6
    const starts = [true, true, true, false, true, true]
    expect(planAlignedPageChunks(starts, 3)).toEqual([{ startPage: 0, endPage: 4 }, { startPage: 4, endPage: 6 }])
  })

  it('안전한 경계가 없으면 maxPagesPerChunk 에서 강제로 자른다', () => {
    const starts = [true, false, false, false, false, false, false]
    expect(planAlignedPageChunks(starts, 3, 5)).toEqual([{ startPage: 0, endPage: 5 }, { startPage: 5, endPage: 7 }])
  })

  it('전체가 n장 이하면 통째 1개', () => {
    expect(planAlignedPageChunks([true, false], 3)).toEqual([{ startPage: 0, endPage: 2 }])
  })
})

// ── 공용 후처리 ─────────────────────────────────────────────────────────────

describe('renumberDuplicateQuestions', () => {
  it('중복·누락 번호를 안 쓰인 가장 작은 번호로 채우고 순서는 보존한다', () => {
    const items = [{ question_number: 1 }, { question_number: 1 }, { question_number: '3번' }, { question_number: null }]
    expect(renumberDuplicateQuestions(items).map((q) => q.question_number)).toEqual([1, 2, 3, 4])
  })
})

describe('propagateSharedPassage', () => {
  it('"윗글의…" 발문인데 지문이 비어 있으면 직전 지문을 복사한다 (청크 경계에 걸린 세트)', () => {
    const items = [
      { question_number: 6, passage: 'The long passage...', question_text: '다음 글의 제목은?' },
      { question_number: 7, passage: '', question_text: '윗글의 내용과 일치하는 것은?' },
    ]
    expect(propagateSharedPassage(items)[1].passage).toBe('The long passage...')
  })

  it('발문에 앞 지문 참조가 없으면 빈 지문을 건드리지 않는다 (지문 없는 문장형 문항 보호)', () => {
    const items = [
      { question_number: 1, passage: 'Some passage', question_text: '다음 글의 주제는?' },
      { question_number: 2, passage: '', question_text: '다음 문장에서 어법상 틀린 것은?' },
    ]
    expect(propagateSharedPassage(items)[1].passage).toBe('')
  })
})

// ── 엔진 ────────────────────────────────────────────────────────────────────

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

  it('pages(2): 4페이지 → 2청크, 각 청크의 pageOffset 은 0, 2', async () => {
    const offsets: number[] = []
    await runParsePipeline({
      label: 't',
      chunk: { kind: 'pages', pagesPerChunk: 2 },
      parseChunk: async (file) => { offsets.push(file.pageOffset ?? -1); return [] },
      finalize: (items) => items,
    }, [{ fileData: await makePdfBase64(4), mimeType: 'application/pdf' }])
    expect(offsets.sort()).toEqual([0, 2])
  })

  it('retry-per-page: 청크가 실패하면 그 청크만 1페이지씩 다시 파싱한다', async () => {
    const calls: number[] = []
    const result = await runParsePipeline({
      label: 't',
      chunk: { kind: 'pages', pagesPerChunk: 3 },
      onChunkError: 'retry-per-page',
      parseChunk: async (file) => {
        const pageCount = (await PDFDocument.load(Buffer.from(file.fileData, 'base64'))).getPageCount()
        calls.push(pageCount)
        if (pageCount > 1) throw new Error('too big')
        return [{ page: file.pageOffset }]
      },
      finalize: (items) => items,
    }, [{ fileData: await makePdfBase64(3), mimeType: 'application/pdf' }])

    // 3페이지 통째(실패) → 1페이지 × 3 (성공)
    expect(calls).toEqual([3, 1, 1, 1])
    expect(result.items).toEqual([{ page: 0 }, { page: 1 }, { page: 2 }])
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
