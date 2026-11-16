import type { SourcePage } from './source-map'

export type BookChoiceRepair = { page: number; line: number; offset: number; from: string; to: string;
  position: number; answer: number; field: 'choice' | 'passage' }

/** Keep every native coordinate, offset, and style run, including the original page evidence. */
export function applyBookChoiceRepair(pages: SourcePage[], repair: BookChoiceRepair): SourcePage[] {
  const page = pages.find(p => p.page === repair.page), line = page?.lines.find(l => l.id === repair.line)
  if (!line || line.text.trim() !== repair.from || line.text[repair.offset] !== repair.from
    || !/^[①②③④⑤]$/u.test(repair.to)) throw Error('선지 번호 교정 위치가 원문과 일치하지 않습니다.')
  const text = line.text.slice(0, repair.offset) + repair.to + line.text.slice(repair.offset + 1)
  return pages.map(p => p === page ? { ...p, lines: p.lines.map(l => l === line ? { ...l, text } : l) } : p)
}
