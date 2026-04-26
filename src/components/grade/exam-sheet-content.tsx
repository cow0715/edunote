'use client'

import { Switch } from '@/components/ui/switch'
import { GradeRow } from '@/hooks/use-grade'
import { ExamQuestion } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ScoreToggleField } from './score-toggle-field'
import { GroupedQuestionRow, QuestionRow } from './question-inputs'
import { ExamBatchUploadButton } from './exam-batch-upload-button'
import { ExamPhotoButton, ExamOcrResult } from './exam-photo-button'

export function ExamSheetContent({ weekId, row, questions, readingTotal, updateRow, updateAnswer, updateAnswerText }: {
  weekId: string
  row: GradeRow
  questions: ExamQuestion[]
  readingTotal: number
  updateRow: (studentId: string, key: keyof GradeRow, value: unknown) => void
  updateAnswer: (studentId: string, questionId: string, value: number | null) => void
  updateAnswerText: (studentId: string, questionId: string, text: string) => void
}) {
  const hasSubjective = questions.some((q) => q.question_style === 'subjective')
  const disabled = !row.present || !row.reading_present

  function applyOcrResults(results: ExamOcrResult[]) {
    for (const r of results) {
      const q = questions.find(
        (q) => q.question_number === r.question_number && (q.sub_label ?? null) === (r.sub_label ?? null)
      )
      if (!q) continue
      if (r.student_answer !== undefined) {
        updateAnswer(row.student_id, q.id, r.student_answer)
      } else if (r.student_answer_text !== undefined) {
        updateAnswerText(row.student_id, q.id, r.student_answer_text)
      }
    }
  }

  return (
    <div>
      {/* OCR 촬영 버튼 */}
      {questions.length > 0 && (
        <div className="flex items-center gap-1 px-4 py-2 border-b bg-gray-50/30">
          <span className="text-xs text-gray-400 mr-1">답안 OCR</span>
          <ExamBatchUploadButton
            weekId={weekId}
            disabled={!row.present}
            onResult={applyOcrResults}
          />
          <ExamPhotoButton
            weekId={weekId}
            side="front"
            disabled={!row.present}
            onResult={applyOcrResults}
          />
          <ExamPhotoButton
            weekId={weekId}
            side="back"
            disabled={!row.present}
            onResult={applyOcrResults}
          />
        </div>
      )}

      {/* 미응시 토글 */}
      {(questions.length > 0 || readingTotal > 0) && (
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-gray-50/50">
          <Switch
            checked={row.reading_present}
            disabled={!row.present}
            onCheckedChange={(checked) => updateRow(row.student_id, 'reading_present', checked)}
          />
          <span className="text-xs text-gray-500">
            {row.reading_present ? '응시' : '미응시'}
          </span>
        </div>
      )}

      {/* 진단평가 직접 입력 (문항 없는 경우) */}
      {readingTotal > 0 && questions.length === 0 && row.reading_present && (
        <div className="px-4 py-3">
          <ScoreToggleField
            label="진단평가"
            total={readingTotal}
            value={row.reading_correct}
            nullLabel="미입력"
            disabled={!row.present}
            onChange={(v) => updateRow(row.student_id, 'reading_correct', v)}
          />
        </div>
      )}

      {questions.length === 0 && readingTotal === 0 && (
        <p className="px-4 py-6 text-xs text-gray-400 text-center">
          설정 → 해설지 탭에서 PDF를 올리면 문항이 표시됩니다.
        </p>
      )}

      {questions.length > 0 && (
        <div className={cn('divide-y', !row.reading_present && 'opacity-40 pointer-events-none')}>
          {Object.values(
            questions.reduce<Record<number, ExamQuestion[]>>((acc, q) => {
              ;(acc[q.question_number] ??= []).push(q)
              return acc
            }, {})
          ).map((group) => {
            if (group.length > 1 && group.every((q) => q.question_style === 'objective')) {
              return (
                <GroupedQuestionRow
                  key={group[0].question_number}
                  questions={group}
                  answers={group.map((q) => row.answers.find((a) => a.exam_question_id === q.id))}
                  disabled={disabled}
                  onChangeAnswer={(qId, n) => updateAnswer(row.student_id, qId, n)}
                />
              )
            }
            return group.map((q) => {
              const answer = row.answers.find((a) => a.exam_question_id === q.id)
              return (
                <QuestionRow
                  key={q.id}
                  q={q}
                  answer={answer}
                  disabled={disabled}
                  onChangeAnswer={(n) => updateAnswer(row.student_id, q.id, n)}
                  onChangeText={(t) => updateAnswerText(row.student_id, q.id, t)}
                />
              )
            })
          })}
        </div>
      )}

      {hasSubjective && row.reading_present && (
        <p className="px-4 py-2 text-xs text-amber-600 border-t bg-amber-50/50">
          서술형은 채점 저장 버튼을 눌러야 AI 채점됩니다
        </p>
      )}
    </div>
  )
}
