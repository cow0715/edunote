/**
 * PDF 조작 공용 유틸 (pdf-lib 기반).
 * 학원 문제지엔 owner-password 암호화 PDF 가 흔해서 load 는 항상 ignoreEncryption 으로 통일한다.
 * (사용자-비밀번호(열기 암호) PDF 는 여전히 실패 — pdf-lib 한계)
 */

import type { PDFDocument as PDFDocumentType } from 'pdf-lib'

export async function loadPdfFromBase64(fileData: string): Promise<PDFDocumentType> {
  const { PDFDocument } = await import('pdf-lib')
  return PDFDocument.load(Buffer.from(fileData, 'base64'), { ignoreEncryption: true })
}

export async function getPdfPageCount(fileData: string): Promise<number> {
  const pdf = await loadPdfFromBase64(fileData)
  return pdf.getPageCount()
}

/** srcDoc 의 [start, end) 페이지를 새 PDF 로 복사해 base64 로 반환 */
async function copyPageRangeToBase64(srcDoc: PDFDocumentType, start: number, end: number): Promise<string> {
  const { PDFDocument } = await import('pdf-lib')
  const chunkPdf = await PDFDocument.create()
  const copiedPages = await chunkPdf.copyPages(
    srcDoc,
    Array.from({ length: end - start }, (_, index) => start + index),
  )
  copiedPages.forEach((page) => chunkPdf.addPage(page))
  const bytes = await chunkPdf.save()
  return Buffer.from(bytes).toString('base64')
}

/** 1페이지씩 쪼개 base64 배열로 (OCR/OMR 페이지 단위 처리용) */
export async function splitPdfToSinglePageBase64(fileData: string): Promise<string[]> {
  const srcDoc = await loadPdfFromBase64(fileData)
  const pages: string[] = []
  for (let i = 0; i < srcDoc.getPageCount(); i += 1) {
    pages.push(await copyPageRangeToBase64(srcDoc, i, i + 1))
  }
  return pages
}

export type PdfChunk = {
  fileData: string
  /** 원본 기준 시작 페이지 (0-base) */
  startPage: number
  /** 원본 기준 끝 페이지 (1-base, inclusive) */
  endPage: number
}

/**
 * pagesPerChunk 페이지 단위로 쪼갠다.
 * 전체가 한 청크에 들어가면 원본 그대로 1개를 반환한다 (재인코딩 생략).
 */
export async function splitPdfIntoChunksBase64(fileData: string, pagesPerChunk: number): Promise<PdfChunk[]> {
  const srcDoc = await loadPdfFromBase64(fileData)
  const pageCount = srcDoc.getPageCount()

  if (pageCount <= pagesPerChunk) {
    return [{ fileData, startPage: 0, endPage: pageCount }]
  }

  const chunks: PdfChunk[] = []
  for (let start = 0; start < pageCount; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk, pageCount)
    chunks.push({ fileData: await copyPageRangeToBase64(srcDoc, start, end), startPage: start, endPage: end })
  }
  return chunks
}

/** 페이지별 텍스트 (unpdf). 서식·레이아웃은 없고 청크 경계 판단 같은 보조 용도로만 쓴다. */
export async function getPdfPageTexts(fileData: string): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(fileData, 'base64')))
  const { text } = await extractText(pdf, { mergePages: false })
  return (Array.isArray(text) ? text : [String(text ?? '')]).map((t) => String(t ?? ''))
}

/** 페이지가 새 문항으로 시작하는지 — "1." / "1)" / "[6~7]" / "01." 등 */
export function pageStartsWithQuestion(pageText: string): boolean {
  const head = pageText.replace(/^\s+/, '').slice(0, 40)
  return /^(?:\[\s*\d+\s*[~\-]\s*\d+\s*\]|\d{1,2}\s*[.)])/.test(head)
}

export type PageRange = { startPage: number; endPage: number }

/**
 * 청크 경계를 문항 경계에 맞춘 페이지 범위 계획 (순수 함수).
 * 기본 pagesPerChunk 장씩 자르되, 자르려는 지점의 다음 페이지가 문항으로 시작하지 않으면
 * (= 지문/문항이 페이지를 넘어가는 중이면) maxPagesPerChunk 까지 청크를 늘려 안전한 경계를 찾는다.
 * 끝까지 안전한 경계가 없으면 maxPagesPerChunk 에서 강제로 자른다.
 */
export function planAlignedPageChunks(
  startsWithQuestion: boolean[],
  pagesPerChunk: number,
  maxPagesPerChunk = pagesPerChunk + 2,
): PageRange[] {
  const pageCount = startsWithQuestion.length
  if (pageCount <= pagesPerChunk) return [{ startPage: 0, endPage: pageCount }]

  const ranges: PageRange[] = []
  let start = 0
  while (start < pageCount) {
    let end = Math.min(start + pagesPerChunk, pageCount)
    // 다음 페이지가 문항 시작이 아니면 경계를 뒤로 민다
    while (end < pageCount && !startsWithQuestion[end] && end - start < maxPagesPerChunk) {
      end += 1
    }
    ranges.push({ startPage: start, endPage: end })
    start = end
  }
  return ranges
}

/** 주어진 페이지 범위들로 PDF 를 쪼갠다 */
export async function splitPdfByRangesBase64(fileData: string, ranges: PageRange[]): Promise<PdfChunk[]> {
  const srcDoc = await loadPdfFromBase64(fileData)
  const pageCount = srcDoc.getPageCount()
  if (ranges.length === 1 && ranges[0].startPage === 0 && ranges[0].endPage === pageCount) {
    return [{ fileData, startPage: 0, endPage: pageCount }]
  }
  const chunks: PdfChunk[] = []
  for (const range of ranges) {
    chunks.push({
      fileData: await copyPageRangeToBase64(srcDoc, range.startPage, range.endPage),
      startPage: range.startPage,
      endPage: range.endPage,
    })
  }
  return chunks
}

/** 앞에서 maxPages 페이지만 잘라낸다 (비용 제한용 — dev 비교 도구 등) */
export async function slicePdfFirstPagesBase64(
  fileData: string,
  maxPages: number,
): Promise<{ fileData: string; originalPageCount: number; testedPageCount: number }> {
  const srcDoc = await loadPdfFromBase64(fileData)
  const pageCount = srcDoc.getPageCount()
  const testedPageCount = Math.min(Math.max(1, maxPages), pageCount)

  if (testedPageCount === pageCount) {
    return { fileData, originalPageCount: pageCount, testedPageCount }
  }

  return {
    fileData: await copyPageRangeToBase64(srcDoc, 0, testedPageCount),
    originalPageCount: pageCount,
    testedPageCount,
  }
}
