'use client'

import { Button } from '@/components/ui/button'
import type { GradeRow } from '@/hooks/use-grade'
import { questionLabel } from '@/lib/question-presentation'
import type { ExamQuestion } from '@/lib/types'

type Answer = GradeRow['answers'][number]

export function needsExamBatchReview(answer: Answer, questions?: ExamQuestion[]) {
  return !!answer.needs_review && !!questions?.some((question) =>
    question.id === answer.exam_question_id &&
    (question.question_style === 'subjective' || question.question_style === 'find_error'))
}

export function ExamBatchReview({ rows, questions, previews, busy, onEdit, onVerdict, onRegrade }: {
  rows: GradeRow[]
  questions: ExamQuestion[]
  previews: Map<string, string>
  busy: boolean
  onEdit: (studentId: string, questionId: string, text: string) => void
  onVerdict: (studentId: string, questionId: string, correct: boolean) => void
  onRegrade: (row: GradeRow, question: ExamQuestion) => void
}) {
  const questionMap = new Map(questions.map((question) => [question.id, question]))
  return (
    <div className="space-y-3" inert={busy}>
      {rows.flatMap((row) => row.answers.filter((answer) => needsExamBatchReview(answer, questions)).map((answer) => {
        const question = questionMap.get(answer.exam_question_id)!
        const preview = previews.get(row.student_id)
        const label = `${row.student_name} · ${questionLabel(question)}`
        return (
          <section key={`${row.student_id}:${question.id}`} className="space-y-3 rounded-xl border bg-card p-4">
            <h3 className="text-sm font-semibold">{label}</h3>
            <p className="break-words text-sm text-muted-foreground">모범답안 · {question.correct_answer_text || '미등록'}</p>
            {question.grading_criteria && <p className="break-words text-sm text-muted-foreground">채점 기준 · {question.grading_criteria}</p>}
            {preview && <a href={preview} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--share-blue)]">원본 보기</a>}
            <label className="block space-y-1 text-sm">
              <span>학생 답안</span>
              <textarea
                aria-label={`${label} 학생 답안`}
                rows={3}
                value={answer.student_answer_text ?? ''}
                disabled={busy}
                onChange={(event) => onEdit(row.student_id, question.id, event.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-base"
              />
            </label>
            {answer.ai_feedback && <p className="break-words text-sm text-muted-foreground">{answer.ai_feedback}</p>}
            <div className="grid grid-cols-3 gap-2">
              <Button className="min-h-11 px-2" variant="outline" disabled={busy} onClick={() => onVerdict(row.student_id, question.id, true)}>정답</Button>
              <Button className="min-h-11 px-2" variant="outline" disabled={busy} onClick={() => onVerdict(row.student_id, question.id, false)}>오답</Button>
              <Button className="min-h-11 px-2" variant="outline" disabled={busy} onClick={() => onRegrade(row, question)}>다시 채점</Button>
            </div>
          </section>
        )
      }))}
    </div>
  )
}
