'use client'

import { useGradeData } from '@/hooks/use-grade'
import { useAttendance } from '@/hooks/use-attendance'
import { ExternalLink } from 'lucide-react'

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
  vocab_correct: number | null
  reading_correct: number | null
  homework_done: number | null
}

type AttendanceStatus = 'present' | 'late' | 'absent'

const ATTENDANCE_BADGE: Record<AttendanceStatus, { label: string; className: string }> = {
  present: { label: '출석', className: 'bg-green-50 text-green-700 border-green-200' },
  late:    { label: '지각', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  absent:  { label: '결석', className: 'bg-red-50 text-red-600 border-red-200' },
}

function ScoreCell({ correct, total, nullLabel = '미응시' }: { correct: number | null; total: number; nullLabel?: string }) {
  if (total === 0) return <span className="text-gray-300">-</span>
  if (correct === null) return <span className="text-xs text-orange-400 font-medium">{nullLabel}</span>
  const pct = Math.round((correct / total) * 100)
  const color = pct < 50 ? 'text-red-500' : pct < 80 ? 'text-amber-500' : pct < 100 ? 'text-blue-500' : 'text-green-600'
  return <span className={`text-xs font-medium ${color}`}>{correct}/{total}</span>
}

export function WeekResultTable({ weekId, classId, startDate, vocabTotal, readingTotal, homeworkTotal }: Props) {
  const { data, isLoading } = useGradeData(weekId)
  const { data: attendanceRecords = [] } = useAttendance(classId, startDate ?? '')

  if (isLoading) return <div className="h-40 animate-pulse rounded-lg bg-gray-100" />

  const { classStudents = [], weekScores = [], questions = [] } = data ?? {}
  const activeQuestions = (questions as { id: string; is_void?: boolean }[]).filter((q) => !q.is_void)
  const effectiveReadingTotal = activeQuestions.length > 0 ? activeQuestions.length : readingTotal
  const scoreMap = new Map<string, ScoreRecord>(weekScores.map((s: ScoreRecord) => [s.student_id, s]))
  const attendanceMap = new Map<string, AttendanceStatus>(
    attendanceRecords.map((a: { student_id: string; status: AttendanceStatus }) => [a.student_id, a.status])
  )

  if (classStudents.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">수강 학생이 없어요. 먼저 학생을 배정해주세요.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="px-3 py-2 text-left">학생</th>
            {effectiveReadingTotal > 0  && <th className="px-2 py-2 text-center">독해</th>}
            {vocabTotal > 0    && <th className="px-2 py-2 text-center">단어</th>}
            {homeworkTotal > 0 && <th className="px-2 py-2 text-center">숙제</th>}
            <th className="px-2 py-2 text-center">출결</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {classStudents.map((cs: { student_id: string; student: { name: string; share_token?: string | null } }) => {
            const score = scoreMap.get(cs.student_id)
            const attendance = attendanceMap.get(cs.student_id)
            const attendanceBadge = attendance ? ATTENDANCE_BADGE[attendance] : null
            const notAbsent = attendance && attendance !== 'absent'

            return (
              <tr key={cs.student_id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{cs.student?.name}</td>

                {effectiveReadingTotal > 0 && (
                  <td className="px-2 py-2 text-center">
                    {score
                      ? <ScoreCell correct={score.reading_correct} total={effectiveReadingTotal} />
                      : notAbsent
                        ? <span className="text-orange-400 font-medium">미응시</span>
                        : <span className="text-gray-300">-</span>}
                  </td>
                )}
                {vocabTotal > 0 && (
                  <td className="px-2 py-2 text-center">
                    {score
                      ? <ScoreCell correct={score.vocab_correct} total={vocabTotal} />
                      : notAbsent
                        ? <span className="text-orange-400 font-medium">미응시</span>
                        : <span className="text-gray-300">-</span>}
                  </td>
                )}
                {homeworkTotal > 0 && (
                  <td className="px-2 py-2 text-center">
                    {score
                      ? <ScoreCell correct={score.homework_done} total={homeworkTotal} nullLabel="미제출" />
                      : notAbsent
                        ? <span className="text-orange-400 font-medium">미제출</span>
                        : <span className="text-gray-300">-</span>}
                  </td>
                )}
                <td className="px-2 py-2 text-center">
                  <div className="flex items-center justify-center gap-1">
                    {attendanceBadge ? (
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${attendanceBadge.className}`}>
                        {attendanceBadge.label}
                      </span>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                    {cs.student?.share_token && (
                      <button
                        onClick={() => window.open(`/share/${cs.student.share_token}`, '_blank')}
                        className="text-gray-300 hover:text-blue-500 transition-colors"
                        title="학부모 공유 페이지"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
