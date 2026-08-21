import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  getPdfPageCount,
  splitPdfToSinglePageBase64,
  splitPdfIntoChunksBase64,
  slicePdfFirstPagesBase64,
} from '../../src/lib/pdf'

async function makePdfBase64(pageCount: number): Promise<string> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i += 1) doc.addPage([200, 200])
  return Buffer.from(await doc.save()).toString('base64')
}

describe('getPdfPageCount', () => {
  it('페이지 수를 읽는다', async () => {
    expect(await getPdfPageCount(await makePdfBase64(5))).toBe(5)
  })
})

describe('splitPdfToSinglePageBase64', () => {
  it('페이지 수만큼 1페이지짜리 PDF 로 쪼갠다', async () => {
    const pages = await splitPdfToSinglePageBase64(await makePdfBase64(3))
    expect(pages).toHaveLength(3)
    for (const page of pages) {
      expect(await getPdfPageCount(page)).toBe(1)
    }
  })
})

describe('splitPdfIntoChunksBase64', () => {
  it('3페이지 단위로 쪼개고 원본 기준 페이지 범위를 기록한다', async () => {
    const chunks = await splitPdfIntoChunksBase64(await makePdfBase64(7), 3)
    expect(chunks.map((c) => [c.startPage, c.endPage])).toEqual([[0, 3], [3, 6], [6, 7]])
    expect(await getPdfPageCount(chunks[0].fileData)).toBe(3)
    expect(await getPdfPageCount(chunks[2].fileData)).toBe(1)
  })

  it('전체가 한 청크에 들어가면 원본을 재인코딩 없이 그대로 반환한다', async () => {
    const original = await makePdfBase64(2)
    const chunks = await splitPdfIntoChunksBase64(original, 3)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ fileData: original, startPage: 0, endPage: 2 })
  })
})

describe('slicePdfFirstPagesBase64', () => {
  it('앞 N페이지만 잘라내고 원본 페이지 수를 함께 알려준다', async () => {
    const sliced = await slicePdfFirstPagesBase64(await makePdfBase64(6), 2)
    expect(sliced.originalPageCount).toBe(6)
    expect(sliced.testedPageCount).toBe(2)
    expect(await getPdfPageCount(sliced.fileData)).toBe(2)
  })

  it('요청이 전체 이상이면 원본 그대로 반환한다', async () => {
    const original = await makePdfBase64(2)
    const sliced = await slicePdfFirstPagesBase64(original, 10)
    expect(sliced.fileData).toBe(original)
    expect(sliced.testedPageCount).toBe(2)
  })
})
