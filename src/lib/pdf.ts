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

// pages 청킹 부속(splitPdfIntoChunksBase64·planAlignedPageChunks·pageStartsWithQuestion·
// splitPdfByRangesBase64·getPdfPageTexts)은 삭제됨 — 입력 청킹이 출력 범위 분할(llm/ranged.ts)로
// 대체되면서 사용처가 사라졌다 (2026-08-27).

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
