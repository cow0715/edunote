import { expect, it } from 'vitest'
import { buildReviewQueue } from '@/lib/review-workflow'
import type { ExamQuestion } from '@/lib/types'
import type { GradeRow } from '@/hooks/use-grade'
const question = { id: 'q', question_style: 'subjective', is_void: false, all_correct: false } as ExamQuestion
function row(id: string, options: Partial<GradeRow> = {}, answer = {}) {
  return { student_id: id, student_name: id, present: true, reading_present: true,
    answers: [{ exam_question_id: 'q', needs_review: true, student_answer_text: '답', ...answer }], ...options } as GradeRow
}
it('keeps source order and includes only actionable unconfirmed review answers', () => {
  const rows = [row('second'), row('absent', { present: false }), row('first'), row('not-taking', { reading_present: false }),
    row('empty', {}, { student_answer_text: '  ' }), row('confirmed', {}, { teacher_confirmed: true }), row('automatic', {}, { needs_review: false })]
  expect(buildReviewQueue([question], rows).map(item => item.studentId)).toEqual(['second', 'first'])
})
it('excludes objective, void and all-correct questions from manual review', () => {
  for (const patch of [{ question_style: 'objective' }, { is_void: true }, { all_correct: true }]) {
    expect(buildReviewQueue([{ ...question, ...patch } as ExamQuestion], [row('s')])).toEqual([])
  }
})
it('supports error-finding questions and preserves subquestion metadata', () => {
  const q = { ...question, question_style: 'find_error', sub_label: 'a' } as ExamQuestion
  expect(buildReviewQueue([q], [row('s')])[0]).toMatchObject({ key: 's_q', question: { sub_label: 'a' }, answer: '답' })
})
