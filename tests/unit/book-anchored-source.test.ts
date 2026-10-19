import { describe, expect, it } from 'vitest'
import { anchoredEvidence, expandAnchoredMapping, planAnchoredSource } from '@/lib/book-pdf/anchored-source'
import type { SourcePage } from '@/lib/book-pdf/source-map'
import { sourceAuditFixture } from '../fixtures/book-source-audit'

function page(x = 300, number = 7): SourcePage {
  const entries: [string, number, number][] = [
    [`${number} Which option is correct?`, 20, 750], [`${number}.`, x, 740], ['[정답]', x, 720], ['②', x + 40, 720],
    ['[해설]', x, 700], ['An explanation of this question.', x, 680], ['[어휘]', x, 660], ['Unbounded vocabulary.', x, 640],
  ]
  return { page: 3, width: 650, height: 800, issues: [], lines: entries.map(([text, x, y], i) => ({ id: i + 1, page: 3, x, y, text, width: text.length * 4, height: 12, marks: [] })) }
}

describe('conservative code-first source anchors', () => {
  it('connects explicit matching numbers and bounded labels without a publisher template', () => {
    const p = planAnchoredSource([page()])
    expect(p.connections.map((c) => [c.question, c.field])).toEqual([['printed:7', 'answer'], ['printed:7', 'solution']])
    expect(p.blocks.find((b) => b.field === 'solution')?.refs).toEqual([{ s: 6, e: 6 }])
    expect(p.blocks.some((b) => (b.field as string) === 'vocabulary')).toBe(false)
  })
  it('works when the explanation column moves to the left', () => {
    const p = page(25); p.lines[0].x = 350
    expect(planAnchoredSource([p]).connections).toHaveLength(2)
  })
  it('does not connect an unmatched explicit number to the sole question', () => {
    const p = page(); p.lines[1].text = '8.'
    expect(planAnchoredSource([p]).connections).toEqual([])
  })
  it('abstains on duplicate question numbers across pages', () => {
    const second = page(); second.page = 4; second.lines.forEach((l) => { l.page = 4; l.id += 20 })
    expect(planAnchoredSource([page(), second]).connections).toEqual([])
  })
  it('does not use single-question inference with a shared-question range', () => {
    const p = page(); p.lines[1].text = '[07~08]'
    expect(planAnchoredSource([p]).connections).toEqual([])
  })
  it('abstains when native extraction raises warnings', () => {
    const p = page(); p.issues = ['unreadable_native_characters']
    expect(planAnchoredSource([p]).blocks).toEqual([])
  })
  it('does not consume an unbounded final explanation', () => {
    const p = page(); p.lines = p.lines.slice(0, 6)
    expect(planAnchoredSource([p]).connections.map((c) => c.field)).toEqual(['answer'])
  })
  it('removes only known bodies from AI coordinate evidence', () => {
    const pages = [page()], plan = planAnchoredSource(pages), e = anchoredEvidence(pages, plan)
    expect(e.pages[0].lines.map((l) => l[0])).toEqual([1, 2, 3, 5, 7, 8])
    expect(e.codeConnections).toContainEqual({ question: 'printed:7', field: 'solution' })
  })
  it('expands a field block and fills omitted code connections', () => {
    const { mapping } = sourceAuditFixture(), input = structuredClone(mapping)
    input.groups[0].questions[0].id = 'printed:7'
    const q = input.groups[0].questions[0] as unknown as Record<string, unknown>
    delete q.answer; delete q.solution
    const plan = planAnchoredSource([page()]), result = expandAnchoredMapping(input, plan)
    expect(result.groups[0].questions[0].answer).toEqual([{ s: 4, e: 4 }])
    expect(result.groups[0].questions[0].solution).toEqual([{ s: 6, e: 6 }])
    q.answer = []
    expect(() => expandAnchoredMapping(input, plan)).toThrow('overwrote')
  })
  it('rejects missing code-connected questions and invented blocks', () => {
    const { mapping } = sourceAuditFixture(), plan = planAnchoredSource([page()])
    expect(() => expandAnchoredMapping(mapping, plan)).toThrow('Missing or duplicate')
    const input = structuredClone(mapping)
    ;(input.groups[0] as unknown as Record<string, unknown>).translation = [{ block: 'invented' }]
    expect(() => expandAnchoredMapping(input, plan)).toThrow('Unknown or mixed')
  })
  it('supports reference expansion without silently changing source boundaries', () => {
    const { mapping } = sourceAuditFixture(), input = structuredClone(mapping)
    ;(input.groups[0] as unknown as Record<string, unknown>).translation = [{ block: 'b' }]
    const out = expandAnchoredMapping(input, { questions: [], connections: [], blocks: [{ id: 'b', field: 'translation', page: 9, refs: [{ s: 2, e: 2 }], owner: null, label: 99 }] })
    expect(out.groups[0].translation).toEqual([{ s: 2, e: 2 }])
  })
  it('keeps unconnected translation and ambiguous bodies in AI evidence', () => {
    const p = page(); p.lines[4].text = '[해석]'
    const plan = planAnchoredSource([p]), evidence = anchoredEvidence([p], plan)
    expect(plan.blocks.some((b) => b.field === 'translation')).toBe(true)
    expect(evidence.pages[0].lines.some((l) => l[0] === 6)).toBe(true)
  })
  it('does not include a separate outer decoration column in a bounded section', () => {
    const p = page(); p.lines.push({ ...p.lines[5], id: 9, x: 610, width: 8, text: '탭' })
    const section = planAnchoredSource([p]).blocks.find((b) => b.field === 'solution')!
    expect(section.refs).toEqual([{ s: 6, e: 6 }])
  })
  it('does not let a number leak into a later unnumbered answer/explanation pair', () => {
    const p = page(); p.lines = p.lines.slice(0, 6)
    const more: [string, number, number][] = [['[정답]',300,660],['③',340,660],['[해설]',300,640],['A different explanation.',300,620],['[어휘]',300,600]]
    p.lines.push(...more.map(([text,x,y],n) => ({ ...p.lines[0], id: n+7,text,x,y,width:text.length*4 })))
    const plan = planAnchoredSource([p])
    expect(plan.connections.map((c) => c.block)).toEqual(['block:3','block:5'])
    expect(plan.blocks.find((b) => b.id === 'block:9')?.owner).toBeNull()
  })
})
