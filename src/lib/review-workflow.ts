import type { GradeRow } from '@/hooks/use-grade'
import type { ExamQuestion } from '@/lib/types'

export type ReviewDraft = { student_id: string; exam_question_id: string; is_correct: boolean }
export type ReviewQueueItem = { key: string; studentId: string; studentName: string; question: ExamQuestion; answer: string; feedback: string }
export const reviewKey = (studentId: string, questionId: string) => `${studentId}_${questionId}`

/** Keep question/student order stable while decisions remain unsaved. */
export function buildReviewQueue(questions: ExamQuestion[], rows: GradeRow[]): ReviewQueueItem[] {
  return questions.filter(q => !q.is_void && !q.all_correct && (q.question_style === 'subjective' || q.question_style === 'find_error'))
    .flatMap(question => rows.flatMap(row => {
      if (!row.present || !row.reading_present) return []
      const answer = row.answers.find(a => a.exam_question_id === question.id)
      if (!answer?.needs_review || answer.teacher_confirmed || !answer.student_answer_text?.trim()) return []
      return [{ key: reviewKey(row.student_id, question.id), studentId: row.student_id, studentName: row.student_name,
        question, answer: answer.student_answer_text, feedback: answer.ai_feedback ?? '' }]
    }))
}
