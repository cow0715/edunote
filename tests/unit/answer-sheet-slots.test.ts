import { describe, expect, it } from 'vitest'
import { answerSheetSlots } from '@/lib/answer-sheet-slots'
import { assignFindErrorAnswers } from '@/lib/find-error-grading'
import { buildExamOcrVisionPrompt } from '@/lib/prompts'

describe('error correction answer sheet contract', () => {
  it('uses the explicit count even when all five options are printed', () => {
    expect(answerSheetSlots([{ question_text: '①~⑤ 중 틀린 것을 2개 찾아 고치시오.' }])).toEqual({ count: 2, optional: false })
    expect(answerSheetSlots([{ question_stem: '틀린 것을 두 개 고르시오.' }]).count).toBe(2)
  })
  it('counts options rather than correct answers and expands ranges', () => {
    expect(answerSheetSlots([{ question_text: '①~⑦ 중 모두 고르시오.' }])).toEqual({ count: 7, optional: true })
    expect(answerSheetSlots([{ question_text: 'ⓐ ⓑ ⓒ ⓓ 중 모두 찾아 고치시오.' }]).count).toBe(4)
    expect(answerSheetSlots([{ choices: ['a', 'b', 'c'] }]).count).toBe(3)
  })
  it('ignores unused slots and matches reversed numeric selections to letter keys', () => {
    const result = assignFindErrorAnswers([{ id: 'a', correctAnswerText: 'a:preferring' }, { id: 'e', correctAnswerText: 'e:are committed' }], ['', '⑤:are committed', '', '①:preferring', ''])
    expect(result.map(r => r.verdict)).toEqual(['correct', 'correct'])
    expect(assignFindErrorAnswers([{ id: 'a', correctAnswerText: 'a:preferring' }], ['']).map(r => r.verdict)).toEqual(['wrong'])
  })
  it('retains overflow answers and routes them to semantic review', () => {
    const result = assignFindErrorAnswers([{ id: 'a', correctAnswerText: 'a:preferring' }], ['①:preferring\n②:wrong'])
    expect(result[0].verdict).toBe('ai')
    expect(result[0].text).toContain('②:wrong')
  })
  it('passes source context, slot rules and blank/overflow handling to OCR', () => {
    const prompt = buildExamOcrVisionPrompt([{ question_number: 8, sub_label: 'a', question_style: 'find_error', question_text: '①~⑤ 중 모두 찾아 고치시오.' }])
    expect(prompt).toContain('인쇄 답란 5칸')
    expect(prompt).toContain('필요한 칸만 작성')
    expect(prompt).toContain('추가 소문항으로 생성하지')
    expect(prompt).toContain('줄바꿈으로 이어 보존')
  })
})
