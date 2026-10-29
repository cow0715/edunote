import { describe, expect, it } from 'vitest'
import { resolveSourceMap, sourceMapSchema, type SourcePage } from '@/lib/book-pdf/source-map'
import { buildExplanationCopyText, buildQuestionCopyText } from '@/lib/exam-bank-copy'
import { readablePassage } from '@/lib/material-display'

function fixture() {
  const texts = ['First sentence.', 'Same paragraph.', 'A real second paragraph.', '모듈', '화되고 시장이', '만들어진다.', 'transcriber 녹취를 글로 옮기는 사', '람', 'observe 준수하다', '의미', '하는 것은?', '①', 'first choice', '② second', '③ third', '④ fourth', '⑤ fifth', '②', '소재', '정답은', '②', '이다.']
  const pages: SourcePage[] = [{ page: 1, width: 600, height: 800, issues: [], lines: texts.map((text, i) => ({
    id: i + 1, page: 1, text, x: 40, y: 780 - i * 14, width: 200, height: 10, marks: i === 3 ? [{ start: 0, end: 2, bold: true, underline: true }] : [],
  })) }]
  const ref = (s: number, e = s) => [{ s, e }]
  const mapping = sourceMapSchema.parse({ layout_version: 1, breaks: [
    { after: 1, before: 2, separator: 'space' }, { after: 2, before: 3, separator: 'paragraph' },
    { after: 4, before: 5, separator: 'join' }, { after: 5, before: 6, separator: 'space' },
    { after: 7, before: 8, separator: 'join' }, { after: 8, before: 9, separator: 'line' },
    { after: 10, before: 11, separator: 'join' }, { after: 12, before: 13, separator: 'space' },
    { after: 20, before: 21, separator: 'space' }, { after: 21, before: 22, separator: 'space' },
  ], groups: [{ passage: ref(1,3), translation: ref(4,6), vocabulary: ref(7,9), visual: [], questions: [{
    id: '3:gateway:1', type: 'implication', label: [], stem: ref(10,11), choices: [ref(12,13),ref(14),ref(15),ref(16),ref(17)],
    answer: ref(18), intent: ref(19), solution: ref(20,22),
  }] }], ignored: [], issues: [] })
  return { pages, mapping }
}

describe('textbook canonical storage layout', () => {
  it('uses the stored text for both display and copy, including vocabulary item boundaries', () => {
    const q = { source_document_id: 'book', question_text: '의미하는 것은?', passage: 'First paragraph.\n\nSecond paragraph.', choices: ['① option'], answer: '①',
      explanation_translation: '모듈화되고 시장이 만들어진다.', explanation_vocabulary: 'URL uniform resource locator\nAPI application programming interface' }
    expect(readablePassage(q.passage, true)).toBe(q.passage)
    expect(readablePassage(q.explanation_vocabulary, true)).toBe(q.explanation_vocabulary)
    expect(buildQuestionCopyText(q, '출처')).toContain(q.passage)
    expect(buildExplanationCopyText(q, '출처')).toContain(q.explanation_vocabulary)
  })
  it('reconstructs words and paragraphs before storage without rewriting native characters or emphasis', () => {
    const { pages, mapping } = fixture(), result = resolveSourceMap(pages, mapping)
    expect(result.errors).toEqual([])
    const e = result.groups[0].extraction
    expect(e.passage).toBe('First sentence. Same paragraph.\n\nA real second paragraph.')
    expect(e.translation).toBe('<strong><u>모듈</u></strong>화되고 시장이 만들어진다.')
    expect(e.vocabulary).toBe('transcriber 녹취를 글로 옮기는 사람\nobserve 준수하다')
    expect(e.questions[0]).toMatchObject({ stem: '의미하는 것은?', choices: ['① first choice','② second','③ third','④ fourth','⑤ fifth'], solution: '정답은 ② 이다.' })
    expect(pages[0].lines[3].text).toBe('모듈')
  })
  it('holds ambiguous or conflicting boundaries instead of silently saving a guessed layout', () => {
    const { pages, mapping } = fixture()
    mapping.breaks = mapping.breaks!.filter((b) => b.after !== 4)
    expect(resolveSourceMap(pages, mapping).errors).toContain('g0:translation:missing_layout_boundary:4:5')
    mapping.breaks.push({ after: 900, before: 1, separator: 'join' })
    expect(resolveSourceMap(pages, mapping).errors).toContain('invalid_layout_boundary')
  })
  it('can still read legacy source maps without modifying their proof reconstruction', () => {
    const { pages, mapping } = fixture()
    delete mapping.layout_version; delete mapping.breaks
    expect(resolveSourceMap(pages, mapping).groups[0].extraction.passage).toBe('First sentence.\nSame paragraph.\nA real second paragraph.')
  })
})
