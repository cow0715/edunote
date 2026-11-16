import { describe, expect, it } from 'vitest'
import { printedChoiceFixture } from '../fixtures/book-printed-choices'
import { checkBookPrintedChoices } from '@/lib/book-pdf/printed-choice-repair'
import { applyBookChoiceRepair } from '@/lib/book-pdf/printed-choice-source'
import { resolveSourceMap } from '@/lib/book-pdf/source-map'

describe('textbook duplicate printed numbers', () => {
  it.each([false, true])('repairs only the numbered glyph while preserving the answer and solution (inline=%s)', inline => {
    const { pages, unit, answer } = printedChoiceFixture(inline)
    const original = structuredClone(pages)
    const checked = checkBookPrintedChoices(pages, unit)
    expect(checked.status).toBe('repair')
    if (checked.status !== 'repair') throw Error('Expected a supported printed typo')
    const { repair, mapping } = checked
    expect(repair).toMatchObject({ from: '③', to: inline ? '④' : '②', position: inline ? 4 : 2, answer })
    const raw = resolveSourceMap(pages, mapping).groups[0].extraction
    const fixedPages = applyBookChoiceRepair(pages, repair)
    const result = resolveSourceMap(fixedPages, mapping)
    const fixed = result.groups[0].extraction
    expect(result.errors).toEqual([])
    expect(fixed.questions[0].answer).toBe(answer)
    expect(fixed.questions[0].solution).toBe(raw.questions[0].solution)
    expect(fixed.questions[0].choices.join('').match(/[①②③④⑤]/gu)?.join('')).toBe('①②③④⑤')
    if (inline) expect(fixed.passage).toContain('④\n<u>Realizing</u>')
    else expect(fixed.questions[0].choices[1]).toMatch(/^②\s+secure/u)
    expect(pages).toEqual(original)
    expect(checkBookPrintedChoices(fixedPages, unit)).toEqual({ status: 'none' })
  })

  it.each(['[정답]', '[해설]', 'Exercise 4', '②', '의 secure를 insecure로 바꿔야 한다.'])('holds if original evidence changes: %s', text => {
    const { pages, unit } = printedChoiceFixture(true)
    const line = pages[0].lines.find(l => l.text === text && l.x >= 300)!
    line.text = text === '②' ? '①' : text.startsWith('의') ? '의 gifts를 바꿔야 한다.' : '[근거 없음]'
    expect(checkBookPrintedChoices(pages, unit).status).toBe('hold')
  })

  it.each([2, 3])('holds if either ambiguous number is the printed answer: %s', answer => {
    const { pages, unit } = printedChoiceFixture()
    unit.questions[0].printed_answer = answer
    expect(checkBookPrintedChoices(pages, unit).status).toBe('hold')
  })

  it('holds even a duplicate that would require more than one number change', () => {
    const { pages, unit } = printedChoiceFixture()
    pages[0].lines.find(l => l.x < 300 && l.text === '④')!.text = '③'
    expect(checkBookPrintedChoices(pages, unit).status).toBe('hold')
  })
})
