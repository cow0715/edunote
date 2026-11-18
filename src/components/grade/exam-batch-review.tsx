'use client'

import { Button } from '@/components/ui/button'
import type { GradeRow } from '@/hooks/use-grade'
import { questionLabel, sortQuestionsByPdf } from '@/lib/question-presentation'
import type { ExamQuestion } from '@/lib/types'
import type { ExamOcrResult } from './exam-photo-button'

type Answer = GradeRow['answers'][number]

function hasRecognizedAnswer(question: ExamQuestion, answer?: {
  student_answer?: number | null
  student_answer_text?: string | null
  ox_selection?: string | null
}) {
  if (!answer) return false
  if (question.question_style === 'objective') {
    const choice = answer.student_answer
    return typeof choice === 'number' && Number.isInteger(choice) && choice >= 1 && choice <= 5
  }
  return !!(answer.student_answer_text?.trim() || answer.ox_selection)
}

export function ExamRecognitionSummary({ rows, questions, photos }: {
  rows: GradeRow[]
  questions: ExamQuestion[]
  photos: { studentId: string | null; ocrResults?: ExamOcrResult[]; previewUrl: string }[]
}) {
  const ordered = sortQuestionsByPdf(questions.filter((question) => !question.is_void))
  if (!ordered.length) return null
  const photoByStudent = new Map(photos.map((photo) => [photo.studentId, photo]))

  return (
    <section aria-labelledby="exam-recognition-summary" className="space-y-2">
      <h3 id="exam-recognition-summary" className="text-sm font-semibold">답안 인식 내역</h3>
      <p className="text-xs text-muted-foreground">미인식에는 빈 답안도 포함됩니다. 확정 전에 원본을 확인해 주세요.</p>
      <ul className="divide-y divide-[var(--share-line-strong)] rounded-xl bg-[var(--share-card)] px-4">
        {rows.map((row) => {
          const photo = photoByStudent.get(row.student_id)
          const results = photo?.ocrResults && new Map(photo.ocrResults.map((answer) => [
            `${answer.question_number}:${answer.sub_label ?? ''}`, answer,
          ]))
          const draft = results ? undefined : new Map(row.answers.map((answer) => [answer.exam_question_id, answer]))
          const missing = ordered.filter((question) => results
            ? !hasRecognizedAnswer(question, results.get(`${question.question_number}:${question.sub_label ?? ''}`))
            : !hasRecognizedAnswer(question, draft?.get(question.id)))
          return (
            <li key={row.student_id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p><span className="font-semibold">{row.student_name}</span> · {ordered.length - missing.length}/{ordered.length}문항 인식</p>
                {photo?.previewUrl && <a className="inline-flex min-h-11 items-center font-medium text-[var(--share-blue)]" href={photo.previewUrl} target="_blank" rel="noopener noreferrer">원본 보기</a>}
              </div>
              {missing.length > 0 && <p className="mt-1 text-[var(--share-red-deep)]">미인식 · {missing.map((question) => questionLabel(question)).join(', ')}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

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
