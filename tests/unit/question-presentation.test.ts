import { describe, expect, it } from 'vitest'
import { groupQuestionParents, groupQuestionPassages, questionLabel, sortQuestionsByPdf, withoutSharedPassage } from '@/lib/question-presentation'
import { buildExamOcrVisionPrompt } from '@/lib/prompts'

const questions = [
  { question_number: 7, source_question_number: 7, display_order: 8, sub_label: null, passage_group: null },
  { question_number: 8, source_question_number: 1, source_section: 'written' as const, display_order: 7, sub_label: 'b', passage_group: 'p6', shared_passage: 'Common passage.' },
  { question_number: 6, source_question_number: 6, display_order: 6, sub_label: null, passage_group: 'p6', shared_passage: 'Common passage.' },
  { question_number: 8, source_question_number: 1, source_section: 'written' as const, display_order: 7, sub_label: 'a', passage_group: 'p6', shared_passage: 'Common passage.' },
]

describe('PDF question presentation', () => {
  it('maps printed written numbers back to internal keys in the OCR prompt in PDF order', () => {
    const prompt = buildExamOcrVisionPrompt(questions.map((q) => ({ ...q, question_style: 'subjective' })))
    expect(prompt).toContain('인쇄 서답형 1 (a): 서술형 → 출력 question_number=8, sub_label="a"')
    expect(prompt.indexOf('- 인쇄 6번')).toBeLessThan(prompt.indexOf('- 인쇄 서답형 1'))
    expect(prompt.indexOf('- 인쇄 서답형 1')).toBeLessThan(prompt.indexOf('- 인쇄 7번'))
  })
  it('preserves PDF order while keeping the internal answer keys distinct', () => {
    expect(sortQuestionsByPdf(questions).map((q) => questionLabel(q))).toEqual(['6번', '서답형 1 (a)', '서답형 1 (b)', '7번'])
    expect(groupQuestionParents(questions).map((g) => g.qNum)).toEqual([6, 8, 7])
    expect(questions[0].question_number).toBe(7) // input not mutated
  })

  it('groups a shared passage across printed numbering sections without merging grading parents', () => {
    const groups = groupQuestionPassages(questions)
    expect(groups.map((g) => g.questions.length)).toEqual([3, 1])
    expect(groups[0].passage).toBe('Common passage.')
    expect(groupQuestionParents(groups[0].questions)).toHaveLength(2)
  })

  it('retains per-question examples, instructions and choices when rendering the shared source once', () => {
    expect(withoutSharedPassage('발문\nCommon\npassage.\n<보기>\n① Choice', 'Common passage.')).toBe('발문\n\n<보기>\n① Choice')
    expect(withoutSharedPassage('원문이 다른 문항', 'Common passage.')).toBe('원문이 다른 문항')
  })

  it('keeps legacy rows usable without guessing a passage group or written numbering', () => {
    expect(sortQuestionsByPdf([{ question_number: 2 }, { question_number: 1 }]).map((q) => questionLabel(q))).toEqual(['1번', '2번'])
    expect(groupQuestionPassages([{ question_number: 1 }, { question_number: 2 }])).toHaveLength(2)
  })
})
