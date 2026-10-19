import { describe, expect, it } from 'vitest'
import { atomizeSourceLines, buildSourceLines, type NativePiece } from '@/lib/book-pdf/layout-source'
import { resolveSourceMap, sourceMapEvidence, sourceMapSchema, type SourceMap, type SourcePage } from '@/lib/book-pdf/source-map'

const ref = (s: number, e = s) => ({ s, e })
function fixture() {
  const texts = ['本文', '해석', 'word 뜻', '출처', '발문?', '①a', '②b', '③c', '④d', '⑤e', '[정답]②', '소재', '해설']
  const pages: SourcePage[] = [{ page: 9, width: 600, height: 800, issues: [], lines: texts.map((text, i) => ({ id: i + 1, page: 9, x: 30, y: 700 - i * 20, width: 100, height: 10, text, marks: [] })) }]
  const mapping: SourceMap = { groups: [{ passage: [ref(1)], translation: [ref(2)], vocabulary: [ref(3)], visual: [], questions: [
    { id: 'q1', label: [ref(4)], type: 'topic', stem: [ref(5)], choices: [6, 7, 8, 9, 10].map((n) => [ref(n)]), answer: [ref(11)], intent: [ref(12)], solution: [ref(13)] },
  ] }], ignored: [], issues: [] }
  return { pages, mapping }
}
describe('native source mapping', () => {
  it('copies source text and derives the answer from the printed source', () => {
    const { pages, mapping } = fixture(), r = resolveSourceMap(pages, sourceMapSchema.parse(mapping))
    expect(r.errors).toEqual([])
    expect(r.groups[0].extraction.questions[0]).toMatchObject({ answer: 2, choices: ['①a', '②b', '③c', '④d', '⑤e'] })
  })
  it('refuses an unknown source id', () => {
    const { pages, mapping } = fixture(); mapping.groups[0].passage = [ref(99)]
    expect(resolveSourceMap(pages, mapping).errors).toContain('g0:passage:invalid_source_range')
  })
  it('accepts single-id shorthand without loosening source bounds', () => {
    const { mapping } = fixture()
    const parsed = sourceMapSchema.parse({ ...mapping, groups: [{ ...mapping.groups[0], passage: [{ s: 1 }] }] })
    expect(parsed.groups[0].passage).toEqual([{ s: 1, e: 1 }])
  })
  it('refuses reversed source bounds', () => {
    const { pages, mapping } = fixture(); mapping.groups[0].passage = [ref(2, 1)]
    expect(resolveSourceMap(pages, mapping).status).toBe('unresolved')
  })
  it('detects missing source characters including after a surrogate pair', () => {
    const { pages, mapping } = fixture(); pages[0].lines[0].text = 'A😀Z'; mapping.groups[0].passage = [{ s: 1, e: 1, b: 3 }]
    expect(resolveSourceMap(pages, mapping).uncovered).toContain(1)
  })
  it('detects two roles consuming the same source text', () => {
    const { pages, mapping } = fixture(); mapping.groups[0].translation.push(ref(1))
    expect(resolveSourceMap(pages, mapping).errors.some((e) => e.includes('overlapping_source'))).toBe(true)
  })
  it('detects a repeated span in the same field', () => {
    const { pages, mapping } = fixture(); mapping.groups[0].passage.push(ref(1))
    expect(resolveSourceMap(pages, mapping).errors).toContain('g0:passage:repeated_source_character')
  })
  it('preserves native underline and bold at their source character positions', () => {
    const { pages, mapping } = fixture(); pages[0].lines[0].text = 'word plain'; pages[0].lines[0].marks = [{ start: 0, end: 4, bold: true, underline: true }]
    expect(resolveSourceMap(pages, mapping).groups[0].extraction.passage).toBe('<strong><u>word</u></strong> plain')
  })
  it('escapes PDF markup instead of interpreting it as generated markup', () => {
    const { pages, mapping } = fixture(); pages[0].lines[0].text = '<script>*note*'
    expect(resolveSourceMap(pages, mapping).groups[0].extraction.passage).toBe('&lt;script&gt;\\*note\\*')
  })
  it('splits options that share one source line with half-open character offsets', () => {
    const { pages, mapping } = fixture(); pages[0].lines[5].text = '①a②b'
    pages[0].lines.splice(6, 1); mapping.groups[0].questions[0].choices![0] = [{ s: 6, e: 6, b: 2 }]; mapping.groups[0].questions[0].choices![1] = [{ s: 6, e: 6, a: 2 }]
    expect(resolveSourceMap(pages, mapping).errors).toEqual([])
    expect(resolveSourceMap(pages, mapping).groups[0].extraction.questions[0].choices.slice(0, 2)).toEqual(['①a', '②b'])
  })
  it('does not accept absent printed answers', () => {
    const { pages, mapping } = fixture(); mapping.groups[0].questions[0].answer = []
    expect(resolveSourceMap(pages, mapping).errors).toContain('g0:q0:ambiguous_printed_answer')
  })
  it('cannot hide a body sentence as a field label or page footer', () => {
    for (const reason of ['field_label', 'page_furniture'] as const) {
      const { pages, mapping } = fixture(); mapping.groups[0].passage = []; mapping.ignored = [{ refs: [ref(1)], reason }]
      expect(resolveSourceMap(pages, mapping).status).toBe('unresolved')
    }
  })
  it('allows several omitted field labels in one reference list', () => {
    const { pages, mapping } = fixture(); pages[0].lines[0].text = '[해석][해설]'; mapping.groups[0].passage = []
    mapping.ignored = [{ refs: [ref(1)], reason: 'field_label' }]
    expect(resolveSourceMap(pages, mapping).errors).toEqual([])
  })
  it('recognizes black printed inline option markers without inventing choice text', () => {
    const { pages, mapping } = fixture(); pages[0].lines[0].text = '❶one❷two❸three❹four❺five'
    mapping.groups[0].questions[0].choices = null
    mapping.ignored = [{ refs: [ref(6, 10)], reason: 'section_label' }]
    expect(resolveSourceMap(pages, mapping).errors).toEqual([])
  })
  it('propagates scan, text decoding and model uncertainty rather than approving it', () => {
    const { pages, mapping } = fixture(); pages[0].issues = ['requires_ocr']; mapping.issues = ['boundary_uncertain']
    expect(resolveSourceMap(pages, mapping).errors).toEqual(['requires_ocr', 'boundary_uncertain'])
  })
  it('does not let the model substitute free text for native spans', () => {
    const { mapping } = fixture()
    expect(sourceMapSchema.safeParse({ ...mapping, groups: [{ ...mapping.groups[0], passage: 'hallucinated sentence' }] }).success).toBe(false)
  })
  it('exports coordinates and original pages without imposing field roles', () => {
    const { pages } = fixture()
    expect(sourceMapEvidence(pages)[0]).toMatchObject({ page: 9, size: [600, 800], lines: [[1, 30, 700, '本文'], ...pages[0].lines.slice(1).map((l) => [l.id, l.x, l.y, l.text])] })
  })
})

const piece = (str: string, x: number, y: number): NativePiece => ({ str, x, y, width: 50, height: 10, bold: false, underline: false })
describe('geometry based native lines', () => {
  it('atomizes printed field labels and inline options without rewriting characters', () => {
    const original = buildSourceLines([piece('[소재] topic ①one②two', 30, 700)], 1, 600)
    const atoms = atomizeSourceLines(original)
    expect(atoms.map((a) => a.text)).toEqual(['[소재]', ' topic ', '①', 'one', '②', 'two'])
    expect(atoms.map((a) => a.text).join('')).toBe(original[0].text)
  })
  it.each([[30], [30, 270], [30, 220, 430]])('preserves one, two and three columns without interleaving: %j', (...xs) => {
    const origins = xs as number[], items = origins.flatMap((x, i) => [piece(`column${i} top`, x, 700), piece(`column${i} bottom`, x, 680)])
    const lines = buildSourceLines(items, 1, 600)
    expect(lines.map((l) => l.text)).toEqual(origins.flatMap((_, i) => [`column${i} top`, `column${i} bottom`]))
  })
  it('retains cross-column headings and footer text instead of discarding them', () => {
    const items = [piece('heading', 30, 760), piece('left', 30, 700), piece('right', 380, 700), piece('footer', 30, 12)]
    expect(buildSourceLines(items, 1, 600).map((l) => l.text).sort()).toEqual(['footer', 'heading', 'left', 'right'])
  })
})
