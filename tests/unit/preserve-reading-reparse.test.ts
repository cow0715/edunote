import { describe, expect, it } from 'vitest'
import { assertPreservableReadingReparse } from '@/lib/preserve-reading-reparse'

const previous = { question_number: 6, sub_label: null, question_style: 'multi_select', correct_answer: 0, correct_answer_text: '2,4' }
const same = { ...previous, source_section: 'general', source_question_number: 6 }
describe('preserving existing answers during a controlled reparse', () => {
  it('allows new written questions while keeping every original grading key unchanged', () => {
    expect(() => assertPreservableReadingReparse([previous], [same,
      { ...same, question_number: 8, source_section: 'written', source_question_number: 1 }])).not.toThrow()
  })
  it.each([
    [], [{ ...same, question_style: 'objective' }], [{ ...same, correct_answer_text: '2,3' }],
    [{ ...same, source_section: 'written' }], [{ ...same, source_question_number: 1 }],
  ].map((parsed) => ({ parsed })))('rejects missing or changed keys before any write', ({ parsed }) => {
    expect(() => assertPreservableReadingReparse([previous], parsed)).toThrow('기존 답안 보존 검사 실패')
  })
})
