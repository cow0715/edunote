import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  getPdfPageCount,
  splitPdfToSinglePageBase64,
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
