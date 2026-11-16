import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { z } from 'zod'
import { atomizeSourceLines, buildSourceLines } from './layout-source'
import type { SourcePage } from './source-map'
import { BOOK_PDFIUM_SOURCE, type BookSourceMode } from './source-mode'

const pageSchema = z.object({
  width: z.number().positive(), height: z.number().positive(),
  issues: z.array(z.string()),
  boxes: z.array(z.object({ left: z.number(), bottom: z.number(), right: z.number(), top: z.number() })).optional(),
  glyphs: z.array(z.object({
    str: z.string().min(1), x: z.number(), y: z.number(), width: z.number().nonnegative(),
    height: z.number().nonnegative(), bold: z.boolean(), italic: z.boolean(), underline: z.boolean(),
  })),
})

export async function readPdfiumSource(bytes: Uint8Array, originalPages: number[], signal?: AbortSignal, mode?: BookSourceMode): Promise<SourcePage[]> {
  if (originalPages.length < 1 || originalPages.length > 4) throw Error('PDFium 원문 추출은 1~4쪽 묶음을 지원합니다.')
  const script = process.env.BOOK_PDFIUM_READER || resolve('scripts/book-pdf-pdfium.py')
  const stdout = await new Promise<string>((accept, reject) => {
    const child = execFile(process.env.BOOK_PDFIUM_PYTHON || 'python3', mode === BOOK_PDFIUM_SOURCE ? [script, '--boxes'] : [script], {
      timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, signal,
    }, (error, output) => error ? reject(new Error('PDFium 원문 추출에 실패했습니다. 워커 설치와 PDF 상태를 확인해주세요.')) : accept(output))
    child.stdin?.on('error', reject)
    child.stdin?.end(bytes)
  })
  const parsed = z.array(pageSchema).max(4).parse(JSON.parse(stdout))
  if (parsed.length !== originalPages.length) throw Error('PDFium 원문 페이지 수가 일치하지 않습니다.')
  let firstId = 1
  return parsed.map(({ width, height, glyphs, issues, boxes }, index) => {
    const page = originalPages[index]
    const lines = atomizeSourceLines(buildSourceLines(glyphs, page, width, firstId, true), firstId)
    firstId += lines.length
    return { page, width, height, lines, issues: issues.map(issue => `page${page}:${issue}`), ...(boxes?.length ? { boxes } : {}) }
  })
}
