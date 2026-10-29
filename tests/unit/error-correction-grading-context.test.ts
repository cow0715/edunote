import { expect, it, vi } from 'vitest'
const capture = vi.hoisted(() => ({ prompt: '' }))
vi.mock('@/lib/llm/client', () => ({
  createLlmExecution: () => ({}),
  callLlmText: vi.fn(async (args: { content: string }) => {
    capture.prompt = args.content
    return JSON.stringify([{ idx: 0, is_correct: true, confidence: 'high', feedback: '' }])
  }),
  parseJsonArrayResponse: (raw: string) => JSON.parse(raw),
}))
import { gradeSubjectiveAnswers } from '@/lib/llm/week'
it('sends the actual source and blank-slot contract to the grading model', async () => {
  const result = await gradeSubjectiveAnswers([{
    question_number: 8, sub_label: 'a', question_style: 'find_error', correct_answer_text: 'a:preferring',
    grading_criteria: '밑줄 친 부분 전부 쓸 것', question_stem: '틀린 것을 모두 고르시오.',
    question_text: '① preferred ⑤ is committed', passage: 'This generation is values-driven.',
  }], [{ week_score_id: 's', exam_question_id: 'q', question_number: 8, sub_label: 'a', student_name: '학생', student_answer_text: '①:preferring' }])
  expect(result[0].is_correct).toBe(true)
  for (const context of ['틀린 것을 모두 고르시오.', '① preferred ⑤ is committed', 'This generation is values-driven.', '밑줄 친 부분 전부 쓸 것', '빈 슬롯은 추가 오답이 아니다', 'a=①']) expect(capture.prompt).toContain(context)
})
