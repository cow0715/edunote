'use client'

import { Badge } from '@/components/ui/badge'
import { useGradeData } from '@/hooks/use-grade'
import { useAttendance } from '@/hooks/use-attendance'
import { ExamQuestion } from '@/lib/types'

interface Props {
  weekId: string
  classId: string
  startDate: string | null
  vocabTotal: number
  readingTotal: number
  homeworkTotal: number
}

type ScoreRecord = {
  student_id: string
  vocab_correct: number
  reading_correct: number
  homework_done: number
  student_answer: {
    exam_question_id: string
    student_answer: number | null
    student_answer_text: string | null
    is_correct: boolean
    ai_feedback: string | null
  }[]
}

type AttendanceStatus = 'present' | 'late' | 'absent'

const ATTENDANCE_BADGE: Record<AttendanceStatus, { label: string; className: string }> = {
  present: { label: '출석', className: 'bg-green-50 text-green-700 border-green-200' },
  late:    { label: '지각', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  absent:  { label: '결석', className: 'bg-red-50 text-red-600 border-red-200' },
}

function questionLabel(q: ExamQuestion): string {
  return q.concept_tag?.concept_category?.name ?? '문항'
}

// 점수 색상: 50% 미만 빨강, 50~79% 주황, 80~99% 파랑, 100% 초록
function scoreColor(correct: number, total: number): string {
  if (total === 0) return 'text-gray-400'
  const pct = correct / total
  if (pct < 0.5)  return 'text-red-500'
  if (pct < 0.8)  return 'text-amber-500'
  if (pct < 1)    return 'text-blue-500'
  return 'text-green-600'
}

function ScoreCell({ correct, total }: { correct: number; total: number }) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0
  const color = scoreColor(correct, total)
  const isCritical = total > 0 && correct / total < 0.5

  return (
    <span className={`${color} ${isCritical ? 'font-bold' : 'font-medium'}`}>
      {isCritical && (
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-red-400 align-middle" />
      )}
      {correct}/{total}
      <span className={`ml-1 text-xs font-normal ${isCritical ? 'opacity-90' : 'opacity-70'}`}>
        ({pct}%)
      </span>
    </span>
  )
}

export function WeekResultTable({ weekId, classId, startDate, vocabTotal, readingTotal, homeworkTotal }: Props) {
  const { data, isLoading } = useGradeData(weekId)
  const { data: attendanceRecords = [] } = useAttendance(classId, startDate ?? '')

  if (isLoading) return <div className="h-40 animate-pulse rounded-lg bg-gray-100" />

  const { classStudents = [], weekScores = [], questions = [] } = data ?? {}
  const scoreMap = new Map<string, ScoreRecord>(weekScores.map((s: ScoreRecord) => [s.student_id, s]))
  const attendanceMap = new Map<string, AttendanceStatus>(
    attendanceRecords.map((a: { student_id: string; status: AttendanceStatus }) => [a.student_id, a.status])
  )

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
            {readingTotal > 0 && (
              <th className="px-3 py-2.5 text-center">진단평가</th>
            )}
            {vocabTotal > 0 && (
              <th className="px-3 py-2.5 text-center">단어</th>
            )}
            {homeworkTotal > 0 && (
              <th className="px-3 py-2.5 text-center">숙제</th>
            )}
            <th className="px-3 py-2.5 text-center">출결</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {classStudents.map((cs: { student_id: string; student: { name: string } }) => {
            const score = scoreMap.get(cs.student_id)
            const attendance = attendanceMap.get(cs.student_id)
            const attendanceBadge = attendance ? ATTENDANCE_BADGE[attendance] : null

            const correctCount = score
              ? (questions as ExamQuestion[]).filter((q) =>
                  score.student_answer?.find((a) => a.exam_question_id === q.id)?.is_correct
                ).length
              : 0

            return (
              <tr key={cs.student_id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{cs.student?.name}</td>

                {/* 문항별 정오 */}
                {(questions as ExamQuestion[]).map((q) => {
                  const ans = score?.student_answer?.find((a) => a.exam_question_id === q.id)
                  return (
                    <td key={q.id} className="px-3 py-3 text-center align-top">
                      {!score ? (
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
                    {score ? (
                      <ScoreCell correct={correctCount} total={questions.length} />
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                )}

                {/* 진단평가 */}
                {readingTotal > 0 && (
                  <td className="px-3 py-3 text-center">
                    {score ? (
                      <ScoreCell correct={score.reading_correct} total={readingTotal} />
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                )}

                {/* 단어 */}
                {vocabTotal > 0 && (
                  <td className="px-3 py-3 text-center">
                    {score ? (
                      <ScoreCell correct={score.vocab_correct} total={vocabTotal} />
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                )}

                {/* 숙제 */}
                {homeworkTotal > 0 && (
                  <td className="px-3 py-3 text-center">
                    {score ? (
                      <ScoreCell correct={score.homework_done} total={homeworkTotal} />
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                )}

                {/* 출결 */}
                <td className="px-3 py-3 text-center">
                  {attendanceBadge ? (
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${attendanceBadge.className}`}>
                      {attendanceBadge.label}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">미입력</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
