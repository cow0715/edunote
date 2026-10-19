import { resolveSourceMap, type SourceMap, type SourcePage } from '@/lib/book-pdf/source-map'
import type { SourceAudit, SourceAuditTarget } from '@/lib/book-pdf/source-audit-state'

export function sourceAuditFixture() {
  const texts = ['Original sentence.', '원문 해석', 'word 뜻', '출처', '발문?', '①a', '②b', '③c', '④d', '⑤e', '[정답]②', '소재', '해설']
  const r = (s: number) => [{ s, e: s }]
  const pages: SourcePage[] = [{ page: 9, width: 600, height: 800, issues: [], lines: texts.map((text, n) => ({ id: n + 1, page: 9, x: 30, y: 700 - n * 20, width: 100, height: 10, text, marks: [] })) }]
  const mapping: SourceMap = { groups: [{ passage: r(1), translation: r(2), vocabulary: r(3), visual: [], questions: [
    { id: 'q1', label: r(4), type: 'topic', stem: r(5), choices: [6, 7, 8, 9, 10].map(r), answer: r(11), intent: r(12), solution: r(13) },
  ] }], ignored: [], issues: [] }
  const draft = resolveSourceMap(pages, mapping).groups
  const target: SourceAuditTarget = { g: 0, q: null, field: 'passage', choice: null }
  const audit: SourceAudit = { status: 'repair', checks: { content: false, mapping: true, formatting: true, inventory: true }, issues: [{ target, kind: 'native_text', pages: [9], reason: '원문과 다름' }] }
  return { pages, mapping, draft, target, audit, imageHashes: { 9: 'original-image-hash' } }
}
