'use client'

import { Badge } from '@/components/ui/badge'
import { useGradeData } from '@/hooks/use-grade'
import { ExamQuestion } from '@/lib/types'

interface Props {
  weekId: string
  vocabTotal: number
  homeworkTotal: number
}

type ScoreRecord = {
  student_id: string
  vocab_correct: number
  homework_done: number
  student_answer: {
    exam_question_id: string
    student_answer: number | null
    student_answer_text: string | null
    is_correct: boolean
    ai_feedback: string | null
  }[]
}

function questionLabel(q: ExamQuestion): string {
  return q.concept_tag?.concept_category?.name ?? '문항'
}

function StatusBadge({ present, scored }: { present: boolean; scored: boolean }) {
  if (!present) return <Badge variant="secondary">결석</Badge>
  if (!scored) return <Badge variant="outline" className="text-amber-600 border-amber-300">미채점</Badge>
  return <Badge variant="outline" className="text-green-600 border-green-300">완료</Badge>
}

export function WeekResultTable({ weekId, vocabTotal, homeworkTotal }: Props) {
  const { data, isLoading } = useGradeData(weekId)

  if (isLoading) return <div className="h-40 animate-pulse rounded-lg bg-gray-100" />

  const { classStudents = [], weekScores = [], questions = [] } = data ?? {}
  const scoreMap = new Map<string, ScoreRecord>(weekScores.map((s: ScoreRecord) => [s.student_id, s]))

  if (classStudents.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">수강 학생이 없어요. 먼저 학생을 배정해주세요.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="px-4 py-2.5 text-left">학생</th>
            {(questions as ExamQuestion[]).map((q) => (
              <th key={q.id} className="px-3 py-2.5 text-center">
                {questionLabel(q)} {q.question_number}번
                {q.question_style === 'subjective' && (
                  <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">서술</span>
                )}
              </th>
            ))}
            {questions.length > 0 && (
              <th className="px-3 py-2.5 text-center">합계</th>
            )}
            {vocabTotal > 0 && (
              <th className="px-3 py-2.5 text-center">단어정답</th>
            )}
            {homeworkTotal > 0 && (
              <th className="px-3 py-2.5 text-center">숙제</th>
            )}
            <th className="px-3 py-2.5 text-center">상태</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {classStudents.map((cs: { student_id: string; student: { name: string } }) => {
            const score = scoreMap.get(cs.student_id)
            const present = !!score
            const scored = present

            const correctCount = score
              ? (questions as ExamQuestion[]).filter((q) =>
                  score.student_answer?.find((a) => a.exam_question_id === q.id)?.is_correct
                ).length
              : 0

            return (
              <tr key={cs.student_id} className={!present ? 'bg-gray-50' : 'hover:bg-gray-50'}>
                <td className="px-4 py-3 font-medium text-gray-900">{cs.student?.name}</td>

                {/* 문항별 정오 */}
                {(questions as ExamQuestion[]).map((q) => {
                  const ans = score?.student_answer?.find((a) => a.exam_question_id === q.id)
                  return (
                    <td key={q.id} className="px-3 py-3 text-center align-top">
                      {!present ? (
                        <span className="text-gray-300">-</span>
                      ) : ans ? (
                        q.question_style === 'subjective' ? (
                          <div className="space-y-1 text-left">
                            <p className="text-xs text-gray-500 leading-snug">{ans.student_answer_text ?? '-'}</p>
                            <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${
                              ans.is_correct ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                            }`}>
                              {ans.is_correct ? '✓ 정답' : `✗ ${ans.ai_feedback || '오답'}`}
                            </span>
                          </div>
                        ) : (
                          <span className={ans.is_correct ? 'font-semibold text-green-600' : 'text-red-500'}>
                            {ans.student_answer ?? '-'}{ans.is_correct ? ' ✓' : ' ✗'}
                          </span>
                        )
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                  )
                })}

                {/* 독해 합계 */}
                {questions.length > 0 && (
                  <td className="px-3 py-3 text-center">
                    {present ? (
                      <span className="font-medium">
                        {correctCount}/{questions.length}
                        <span className="ml-1 text-xs text-gray-400">
                          ({Math.round((correctCount / questions.length) * 100)}%)
                        </span>
                      </span>
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                )}

                {/* 단어 */}
                {vocabTotal > 0 && (
                  <td className="px-3 py-3 text-center">
                    {present ? (
                      <span className={score.vocab_correct < vocabTotal ? 'text-amber-500' : 'text-green-600'}>
                        {score.vocab_correct}/{vocabTotal}
                      </span>
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                )}

                {/* 숙제 */}
                {homeworkTotal > 0 && (
                  <td className="px-3 py-3 text-center">
                    {present ? (
                      <span className={score.homework_done < homeworkTotal ? 'text-amber-500' : 'text-green-600'}>
                        {score.homework_done}/{homeworkTotal}
                      </span>
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                )}

                {/* 상태 */}
                <td className="px-3 py-3 text-center">
                  <StatusBadge present={present} scored={scored} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
