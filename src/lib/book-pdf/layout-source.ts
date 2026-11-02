import { bookItemUnderlined, bookUnderlineSegments } from './underlines'
import type { SourceLine, SourcePage } from './source-map'

export type NativePiece = { str: string; x: number; y: number; width: number; height: number; bold: boolean; underline: boolean }

/** Printed separators make exact source atoms without assigning field roles. */
export function atomizeSourceLines(lines: SourceLine[], firstId = 1): SourceLine[] {
  let id = firstId
  return lines.flatMap((line) => {
    const cuts = new Set([0, line.text.length])
    for (const match of line.text.matchAll(/\[\s*(?:정답|소재|해석|해설|풀이|어휘|Answer|Translation|Explanation|Vocabulary)\s*\]|[①②③④⑤❶❷❸❹❺]|^\s*[o□▪▫◦○●](?=\s)/g)) {
      cuts.add(match.index); cuts.add(match.index + match[0].length)
    }
    const offsets = [...cuts].sort((a, b) => a - b)
    return offsets.slice(0, -1).flatMap((a, i) => {
      const b = offsets[i + 1]
      if (!line.text.slice(a, b).trim()) return []
      return [{ ...line, id: id++, text: line.text.slice(a, b),
        // Position is a visual aid; field reconstruction uses exact characters.
        x: line.x + line.width * a / line.text.length, width: line.width * (b - a) / line.text.length,
        marks: line.marks.flatMap((m) => m.end > a && m.start < b ? [{ ...m, start: Math.max(m.start, a) - a, end: Math.min(m.end, b) - a }] : []) }]
    })
  })
}

/** Group only neighboring glyph runs. Wide horizontal gaps remain separate so
 * two columns and vocabulary tables cannot be interleaved into one sentence. */
export function buildSourceLines(items: NativePiece[], page: number, width: number, firstId = 1): SourceLine[] {
  const rows: { y: number; pieces: NativePiece[] }[] = []
  for (const piece of [...items].filter((p) => p.str.length).sort((a, b) => b.y - a.y || a.x - b.x)) {
    let row = rows.find((r) => Math.abs(r.y - piece.y) < 1.5)
    if (!row) { row = { y: piece.y, pieces: [] }; rows.push(row) }
    row.pieces.push(piece)
  }
  const fragments: Omit<SourceLine, 'id'>[] = []
  for (const row of rows) {
    let parts: NativePiece[] = []
    const flush = () => {
      if (!parts.length) return
      let text = ''
      const marks: SourceLine['marks'] = []
      for (let n = 0; n < parts.length; n++) {
        const p = parts[n], before = parts[n - 1]
        if (before && p.x - before.x - before.width > 1.5) text += ' '
        const start = text.length; text += p.str
        if (p.bold || p.underline) marks.push({ start, end: text.length, bold: p.bold, underline: p.underline })
      }
      if (text.trim()) fragments.push({ page, x: parts[0].x, y: row.y, width: Math.max(...parts.map((p) => p.x + p.width)) - parts[0].x,
        height: Math.max(...parts.map((p) => p.height)), text, marks })
      parts = []
    }
    for (const p of row.pieces.sort((a, b) => a.x - b.x)) {
      const before = parts.at(-1)
      if (before && p.x - before.x - before.width > Math.max(12, Math.min(p.height, before.height) * 1.6)) flush()
      parts.push(p)
    }
    flush()
  }
  // Detect separated origin clusters; the split is inferred from this page,
  // never a fixed half-page boundary. Full-width headings remain intact.
  const origins = [...new Set(fragments.filter((f) => f.text.trim().length > 5).map((f) => Math.round(f.x)))].sort((a, b) => a - b)
  const cuts = origins.slice(1).flatMap((x, i) => x - origins[i] > width * 0.16 ? [(x + origins[i]) / 2] : [])
  const column = (x: number) => cuts.filter((cut) => x > cut).length
  return fragments.sort((a, b) => column(a.x) - column(b.x) || b.y - a.y || a.x - b.x).map((f, i) => ({ ...f, id: firstId + i }))
}

/** Preserve every native text item, including page furniture. The model must
 * explicitly account for ignored labels; no template-specific text is cut out. */
export async function readLayoutSource(bytes: Uint8Array, originalPages?: number[]): Promise<SourcePage[]> {
  const { getDocumentProxy, getResolvedPDFJS } = await import('unpdf')
  const { OPS } = await getResolvedPDFJS(), pdf = await getDocumentProxy(bytes.slice())
  try {
    if (pdf.numPages > 600 || (originalPages && originalPages.length !== pdf.numPages)) throw Error('Invalid source page selection')
    const pages: SourcePage[] = []
    let id = 1
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n), viewport = page.getViewport({ scale: 1 }), content = await page.getTextContent()
      const strokes = bookUnderlineSegments(await page.getOperatorList(), OPS), issues: string[] = []
      const pieces: NativePiece[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue
        const font = page.commonObjs.get(item.fontName) as { name?: string }
        if (/\uFFFD/.test(item.str)) issues.push(`page${n}:unreadable_native_characters`)
        if (Math.abs(item.transform[1]) > 0.1 || Math.abs(item.transform[2]) > 0.1) issues.push(`page${n}:rotated_text_requires_visual_check`)
        pieces.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width,
          height: Math.abs(item.height) || Math.hypot(item.transform[0], item.transform[1]),
          bold: /bold|black|heavy/i.test(font.name ?? ''), underline: strokes.some((s) => bookItemUnderlined(item, s)) })
      }
      const lines = atomizeSourceLines(buildSourceLines(pieces, originalPages?.[n - 1] ?? n, viewport.width), id)
      if (lines.reduce((sum, l) => sum + l.text.trim().length, 0) < 20) issues.push(`page${n}:insufficient_native_text_requires_ocr`)
      pages.push({ page: originalPages?.[n - 1] ?? n, width: viewport.width, height: viewport.height, lines, issues: [...new Set(issues)] })
      id += lines.length
      page.cleanup()
    }
    return pages
  } finally { await pdf.destroy() }
}
