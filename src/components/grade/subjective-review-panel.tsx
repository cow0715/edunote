'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ExamQuestion } from '@/lib/types'
import { GradeRow } from '@/hooks/use-grade'
import { StyleBadge } from './question-inputs'
import { Button } from '@/components/ui/button'

type Override = { student_id: string; exam_question_id: string; is_correct: boolean }

function sortPriority(a: {
  answered: boolean
  needs_review: boolean
  is_correct: boolean | undefined
}): number {
  if (!a.answered) return 3
  if (a.needs_review) return 0
  if (a.is_correct === false) return 1
  if (a.is_correct === true) return 2
  return 3
}

export function SubjectiveReviewPanel({
  weekId,
  questions,
  rows,
}: {
  weekId: string
  questions: ExamQuestion[]
  rows: GradeRow[]
}) {
  const qc = useQueryClient()
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map())

  const subjectiveQuestions = questions.filter(
    (q) => q.question_style === 'subjective' || q.question_style === 'find_error'
  )

  function getKey(studentId: string, questionId: string) {
    return `${studentId}_${questionId}`
  }

  function toggle(studentId: string, questionId: string, currentIsCorrect: boolean | undefined) {
    const key = getKey(studentId, questionId)
    setOverrides((prev) => {
      const next = new Map(prev)
      // ⚠️ 또는 미확정: 첫 클릭 → 정답, 재클릭 → 오답 반복
      const newIsCorrect = currentIsCorrect === true ? false : true
      next.set(key, { student_id: studentId, exam_question_id: questionId, is_correct: newIsCorrect })
      return next
    })
  }

  const confirm = useMutation({
    mutationFn: async () => {
      const body = [...overrides.values()]
      if (body.length === 0) return
      const res = await fetch(`/api/weeks/${weekId}/grade-confirm`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('저장 실패')
    },
    onSuccess: () => {
      setOverrides(new Map())
      qc.refetchQueries({ queryKey: ['grade', weekId] })
      toast.success('검토 결과가 저장되었습니다')
    },
    onError: () => toast.error('저장 실패'),
  })

  if (subjectiveQuestions.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-6">서술형 문항이 없습니다.</p>
  }

  const pendingCount = overrides.size

  return (
    <div className="space-y-5">
      {subjectiveQuestions.map((q) => {
        const studentRows = rows
          .filter((r) => r.present && r.reading_present)
          .map((r) => {
            const answer = r.answers.find((a) => a.exam_question_id === q.id)
            const key = getKey(r.student_id, q.id)
            const override = overrides.get(key)
            const isOverridden = !!override
            const isCorrect = isOverridden ? override.is_correct : answer?.is_correct
            const needsReview = isOverridden ? false : (answer?.needs_review ?? false)
            return {
              student_id: r.student_id,
              student_name: r.student_name,
              answered: !!(answer?.student_answer_text),
              student_answer_text: answer?.student_answer_text ?? '',
              is_correct: isCorrect,
              needs_review: needsReview,
              teacher_confirmed: isOverridden || (answer?.teacher_confirmed ?? false),
              ai_feedback: answer?.ai_feedback ?? '',
              isOverridden,
            }
          })
          .sort((a, b) => sortPriority(a) - sortPriority(b))

        const qLabel = `${q.question_number}번${q.sub_label ? ` (${q.sub_label})` : ''}`

        return (
          <div key={q.id} className="rounded-lg border overflow-hidden">
            {/* 문항 헤더 */}
            <div className="bg-gray-50 px-4 py-3 border-b space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{qLabel}</span>
                <StyleBadge style={q.question_style} />
              </div>
              <p className="text-xs text-gray-600">
                모범답안: <span className="font-medium">{q.correct_answer_text}</span>
              </p>
              {q.grading_criteria && (
                <p className="text-xs text-gray-400 line-clamp-2">기준: {q.grading_criteria}</p>
              )}
            </div>

            {/* 학생 답안 테이블 */}
            <table className="w-full text-sm">
              <thead className="bg-gray-50/50 text-xs text-gray-400 border-b">
                <tr>
                  <th className="px-4 py-2 text-left w-20">학생</th>
                  <th className="px-4 py-2 text-left">학생 답안</th>
                  <th className="px-4 py-2 text-left w-40">AI 피드백</th>
                  <th className="px-4 py-2 text-center w-24">결과</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {studentRows.map((sr) => (
                  <tr
                    key={sr.student_id}
                    className={cn(
                      'hover:bg-gray-50/50',
                      sr.needs_review && 'bg-amber-50/40'
                    )}
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-700 whitespace-nowrap">
                      {sr.student_name}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {sr.student_answer_text || (
                        <span className="text-gray-300 text-xs">미입력</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">{sr.ai_feedback}</td>
                    <td className="px-4 py-2.5 text-center">
                      {!sr.answered ? (
                        <span className="text-gray-300 text-xs">—</span>
                      ) : sr.is_correct === undefined ? (
                        <span className="text-xs text-gray-300">미채점</span>
                      ) : (
                        <button
                          type="button"
                          title="클릭해서 정답/오답 전환"
                          onClick={() => toggle(sr.student_id, q.id, sr.is_correct)}
                          className={cn(
                            'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                            sr.isOverridden
                              ? sr.is_correct
                                ? 'bg-green-600 text-white hover:bg-green-700'
                                : 'bg-red-500 text-white hover:bg-red-600'
                              : sr.needs_review
                                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                : sr.is_correct
                                  ? 'bg-green-50 text-green-700 hover:bg-green-100'
                                  : 'bg-red-50 text-red-500 hover:bg-red-100'
                          )}
                        >
                          {sr.needs_review && !sr.isOverridden
                            ? '⚠️ 검토'
                            : sr.is_correct
                              ? '✓ 정답'
                              : '✗ 오답'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}

      <div className="flex justify-end">
        <Button
          onClick={() => confirm.mutate()}
          disabled={confirm.isPending || pendingCount === 0}
          variant={pendingCount > 0 ? 'default' : 'outline'}
        >
          {confirm.isPending
            ? '저장 중...'
            : pendingCount > 0
              ? `검토 완료 저장 (${pendingCount}건)`
              : '변경 없음'}
        </Button>
      </div>
    </div>
  )
}
