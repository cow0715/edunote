import { describe, expect, it } from 'vitest'
import type { ParsedAnswer } from '@/lib/llm/week'
import { weekAnswerContractIssues, normalizeNewCorrectionKey, canRepairCorrectionInventory } from '@/lib/week-answer-contract'
import { resolveAnswerReview, type ReviewAnswer } from '@/lib/week-answer-review'
import { sanitizeWeekExtraction } from '@/lib/week-extraction-shape'
import { normalizeParsedAnswers } from '@/lib/week-reading-import'

function q(over: Partial<ParsedAnswer> = {}): ParsedAnswer {
  return { question_number: 1, sub_label: 'b', question_style: 'find_error', question_type: null,
    question_text: '①~⑤ 중 틀린 것을 2개 찾아 번호를 쓰고 고치시오.', question_stem: null,
    correct_answer: 0, correct_answer_text: 'b:asked', grading_criteria: null, explanation: null,
    answer_status: 'found', answer_evidence: { file_index: 1, page: 1, quote: '정답 ② asked ⑤ were' }, ...over }
}
const valid = () => [q(), q({ sub_label: 'e', correct_answer_text: 'e:were' })]

describe('new question correction contract', () => {
  it('accepts split independent answers and rejects subjective/OX/multi-select misclassification', () => {
    expect(weekAnswerContractIssues(valid())).toEqual([])
    for (const question_style of ['subjective', 'ox', 'multi_select'] as const) {
      expect(weekAnswerContractIssues(valid().map(a => ({ ...a, question_style })))).toEqual(expect.arrayContaining([expect.stringContaining('find_error')]))
    }
  })
  it('rejects merged keys, missing siblings, mismatched symbols and duplicate selections', () => {
    expect(weekAnswerContractIssues([q({ correct_answer_text: 'b:asked / e:were' })]).join()).toContain('별도 객체')
    expect(weekAnswerContractIssues([q({ sub_label: 'a' }), q({ sub_label: 'e', correct_answer_text: 'e:were' })]).join()).toContain('실제 기호')
    expect(weekAnswerContractIssues([q(), q()]).join()).toContain('중복')
    expect(canRepairCorrectionInventory([q()])).toBe(false)
    expect(canRepairCorrectionInventory(valid())).toBe(true)
  })
  it('does not turn five options into five correct answers for all-selection', () => {
    const rows = valid().map(a => ({ ...a, question_text: '①~⑤ 중 틀린 것을 모두 찾아 고치시오.' }))
    expect(weekAnswerContractIssues(rows)).toEqual([])
  })
  it('does not demand invented corrections when the source answer is missing', () => {
    expect(weekAnswerContractIssues([q({ answer_status: 'missing', sub_label: null, correct_answer_text: null })])).toEqual([])
  })
  it('distinguishes full-item copying from actual O/X instructions', () => {
    const text = '밑줄 친 ⓐ~ⓓ를 모두 고치고 옳은 것은 그대로 순서대로 쓰시오.'
    expect(weekAnswerContractIssues([q({ question_text: text, question_style: 'ox' })]).join()).toContain('subjective')
    expect(weekAnswerContractIssues([q({ question_text: text, question_style: 'subjective' })])).toEqual([])
    expect(weekAnswerContractIssues([q({ question_text: '맞으면 O, 틀리면 X를 표기하고 고치시오.', question_style: 'ox' })])).toEqual([])
    expect(weekAnswerContractIssues([q({ question_text: '맞으면 O, 틀리면 X를 표기하고 고치시오.' })]).join()).toContain('ox')
    expect(weekAnswerContractIssues(valid().map(a => ({ ...a, question_text: '①~⑤ 중 틀린 것을 2개 찾아 기호 순서대로 고치시오.' })))).toEqual([])
  })
  it('keeps unnumbered word corrections and correction plus meaning as subjective', () => {
    const words = ['different → similar', 'undermine → reinforce'].map((key, i) => q({ sub_label: i ? 'b' : 'a', question_style: 'subjective', correct_answer_text: key, question_text: '문맥상 부적절한 단어 2개를 골라 쓰고 고치시오.' }))
    expect(weekAnswerContractIssues(words)).toEqual([])
    expect(weekAnswerContractIssues(words.map(a => ({ ...a, question_style: 'find_error' })))).not.toEqual([])
    expect(weekAnswerContractIssues([q({ question_style: 'subjective', question_text: '①~⑤ 중 틀린 표현을 골라 고치고 우리말 뜻을 쓰시오.' })])).toEqual([])
  })
  it('preserves f/g source keys across new extraction and normalization without changing legacy normalization', () => {
    expect(normalizeNewCorrectionKey('ⓖ: has → had')).toBe('g:had')
    const bundled = normalizeNewCorrectionKey('b:asked / e:were')
    expect(bundled).toBe('b:asked / e:were')
    expect(weekAnswerContractIssues([q({ question_text: '①~⑤ 중 틀린 것을 모두 찾아 고치시오.', correct_answer_text: bundled })]).join()).toContain('묶지')
    const raw = q({ question_text: 'ⓐ~ⓖ 중 틀린 것을 1개 찾아 고치시오.', sub_label: 'g', correct_answer_text: 'g:had', inventory_sub_labels: ['g'] })
    const next = normalizeParsedAnswers([sanitizeWeekExtraction(raw, true)], true)
    expect(next[0].correct_answer_text).toBe('g:had')
    expect(weekAnswerContractIssues(next)).toEqual([])
  })
  it('checks new confirmation again, but keeps existing question review behavior unchanged', () => {
    const candidate = { ...q({ question_style: 'subjective', sub_label: null, correct_answer_text: 'b:asked / e:were' }), evidence_verified: true, review_reasons: [] } as ReviewAnswer
    expect(() => resolveAnswerReview({ answers: [candidate], base_questions: [] }, [{ index: 0, reviewed: true }])).toThrow('답안 형식')
    expect(resolveAnswerReview({ answers: [candidate], base_questions: [{ ...candidate, id: 'existing' }] }, [{ index: 0, reviewed: true, keep_existing: true }])[0].answer_origin).toBe('existing')
  })
})
