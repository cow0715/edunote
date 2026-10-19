import type { BookPage } from './types'
import { bookItemUnderlined, bookUnderlineSegments } from './underlines'

type TextItem = { str: string; transform: number[]; width: number; fontName?: string }
function lines(items: TextItem[]) {
  const rows: Array<{ y: number; items: TextItem[] }> = []
  for (const item of [...items].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
    let row = rows.find((r) => Math.abs(r.y - item.transform[5]) < 2)
    if (!row) { row = { y: item.transform[5], items: [] }; rows.push(row) }
    row.items.push(item)
  }
  return rows.map((r) => {
    const parts = r.items.sort((a, b) => a.transform[4] - b.transform[4])
    return parts.map((p, i) => (i && p.transform[4] - parts[i - 1].transform[4] - parts[i - 1].width > 1.5 ? ' ' : '') + p.str).join('').trim()
  }).filter(Boolean).join('\n')
}

export async function readBookPages(bytes: Uint8Array): Promise<BookPage[]> {
  const { getDocumentProxy, getResolvedPDFJS } = await import('unpdf')
  const { OPS } = await getResolvedPDFJS()
  const pdf = await getDocumentProxy(bytes.slice())
  try {
    if (pdf.numPages > 600) throw new Error('한 파일은 최대 600페이지까지 지원합니다.')
    const result: BookPage[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const all = content.items.filter((item): item is typeof item & TextItem => 'str' in item)
      // The outer 5% contains the vertical publisher tab, outside both body columns.
      const body = all.filter((t) => t.transform[5] > 32 && t.transform[5] < viewport.height - 30 && t.transform[4] < viewport.width * 0.95)
      const strokes = bookUnderlineSegments(await page.getOperatorList(), OPS)
      const underlines = strokes.flatMap((stroke) => {
        const selected = body.filter((item) => bookItemUnderlined(item, stroke))
        if (!selected.length) return []
        const side = selected[0].transform[4] < viewport.width / 2 ? 'left' as const : 'right' as const
        const context = body.filter((item) => Math.abs(item.transform[5] - selected[0].transform[5]) < 2 && (item.transform[4] < viewport.width / 2) === (side === 'left'))
        return [{ page: i, side, text: lines(selected), context: lines(context) }]
      })
      // The English body uses serif fonts. Their actual Bold font variants are
      // evidence for emphasized words/markers, independent of AI transcription.
      const bold = body.filter((item) => {
        if (!item.fontName || !/[a-z]/i.test(item.str) || content.styles[item.fontName]?.fontFamily !== 'serif') return false
        const font = page.commonObjs.get(item.fontName) as { name?: string }
        return /bold|black|heavy/i.test(font.name ?? '')
      }).map((item) => {
        const side = item.transform[4] < viewport.width / 2 ? 'left' as const : 'right' as const
        const context = body.filter((other) => Math.abs(other.transform[5] - item.transform[5]) < 2 && (other.transform[4] < viewport.width / 2) === (side === 'left'))
        return { page: i, side, text: item.str, context: lines(context) }
      })
      result.push({ page: i, left: lines(body.filter((t) => t.transform[4] < viewport.width / 2)),
        right: lines(body.filter((t) => t.transform[4] >= viewport.width / 2)), full: lines(all), ...(underlines.length ? { underlines } : {}), ...(bold.length ? { bold } : {}) })
      page.cleanup()
    }
    return result
  } finally { await pdf.destroy() }
}

export async function bookPageSlice(bytes: Uint8Array, pages: number[]) {
  const { PDFDocument } = await import('pdf-lib')
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const target = await PDFDocument.create()
  target.setCreationDate(new Date(0))
  target.setModificationDate(new Date(0))
  for (const page of await target.copyPages(source, pages.map((p) => p - 1))) target.addPage(page)
  return Buffer.from(await target.save()).toString('base64')
}
