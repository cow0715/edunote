'use client'

import { useState, useEffect } from 'react'
import { Save, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { ClassStudent } from '@/lib/types'
import { useAttendance, useSaveAttendance } from '@/hooks/use-attendance'

interface Props {
  classId: string
  classStudents: ClassStudent[]
  defaultDate?: string
  scheduledDates?: string[]  // 수업 스케줄 날짜 목록
}

type AttendanceStatus = 'present' | 'late' | 'absent'

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: '출석',
  late: '지각',
  absent: '결석',
}

const STATUS_STYLE: Record<AttendanceStatus, string> = {
  present: 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200',
  late: 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200',
  absent: 'bg-red-100 text-red-700 border-red-200 hover:bg-red-200',
}

const STATUS_ORDER: AttendanceStatus[] = ['present', 'late', 'absent']

const KO_DAYS = ['일', '월', '화', '수', '목', '금', '토']

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function getDayLabel(dateStr: string) {
  // "YYYY-MM-DD" → 로컬 요일 (timezone 이슈 방지용 T00:00 추가)
  const d = new Date(dateStr + 'T00:00:00')
  return KO_DAYS[d.getDay()] + '요일'
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function offsetDate(date: string, days: number) {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function AttendanceManager({ classId, classStudents, defaultDate, scheduledDates }: Props) {
  const initDate = defaultDate ?? todayStr()
  const [date, setDate] = useState(initDate)
  const [statusMap, setStatusMap] = useState<Record<string, AttendanceStatus>>({})

  const { data: records, isLoading } = useAttendance(classId, date)
  const saveAttendance = useSaveAttendance(classId)

  useEffect(() => {
    if (records) {
      const map: Record<string, AttendanceStatus> = {}
      classStudents.forEach((cs) => { map[cs.student_id] = 'present' })
      records.forEach((r) => { map[r.student_id] = r.status })
      setStatusMap(map)
    }
  }, [records, classStudents])

  // 스케줄 기반 prev/next
  function prevDate() {
    if (scheduledDates) {
      const idx = scheduledDates.indexOf(date)
      if (idx > 0) setDate(scheduledDates[idx - 1])
    } else {
      setDate(offsetDate(date, -7))
    }
  }

  function nextDate() {
    if (scheduledDates) {
      const idx = scheduledDates.indexOf(date)
      if (idx < scheduledDates.length - 1) setDate(scheduledDates[idx + 1])
    } else {
      setDate(offsetDate(date, 7))
    }
  }

  const isFirst = scheduledDates ? scheduledDates.indexOf(date) <= 0 : false
  const isLast = scheduledDates
    ? scheduledDates.indexOf(date) >= scheduledDates.length - 1
    : date >= todayStr()

  // 스케줄 기반일 때 현재 날짜가 목록에 없으면 가장 가까운 날짜로 맞추기
  useEffect(() => {
    if (scheduledDates && scheduledDates.length > 0 && !scheduledDates.includes(date)) {
      // defaultDate와 가장 가까운 scheduled date 찾기
      const closest = scheduledDates.reduce((prev, cur) =>
        Math.abs(new Date(cur).getTime() - new Date(initDate).getTime()) <
        Math.abs(new Date(prev).getTime() - new Date(initDate).getTime()) ? cur : prev
      )
      setDate(closest)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduledDates])

  async function handleSave() {
    try {
      await saveAttendance.mutateAsync({
        date,
        records: classStudents.map((cs) => ({
          student_id: cs.student_id,
          status: statusMap[cs.student_id] ?? 'present',
        })),
      })
      toast.success('출결이 저장되었습니다')
    } catch {
      toast.error('저장 실패')
    }
  }

  const counts = { present: 0, late: 0, absent: 0 }
  classStudents.forEach((cs) => { counts[statusMap[cs.student_id] ?? 'present']++ })

  return (
    <div className="space-y-4">
      {/* 날짜 네비 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={prevDate} disabled={isFirst}>
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {scheduledDates ? (
            /* 스케줄 기반: 날짜 + 요일 표시 */
            <div className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm min-w-[120px] justify-center">
              <span className="font-medium text-gray-900">{formatDate(date)}</span>
              <span className="text-xs text-primary font-medium">{getDayLabel(date)}</span>
            </div>
          ) : (
            /* 자유 선택: date input */
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          )}

          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={nextDate} disabled={isLast}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* 요약 배지 */}
        <div className="flex gap-1.5">
          {(['present', 'late', 'absent'] as AttendanceStatus[]).map((s) => (
            <span key={s} className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[s]}`}>
              {STATUS_LABEL[s]} {counts[s]}
            </span>
          ))}
        </div>
      </div>

      {/* 학생 목록 */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : classStudents.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">수강 학생이 없어요</p>
      ) : (
        <div className="space-y-1.5">
          {classStudents.map((cs) => {
            const status = statusMap[cs.student_id] ?? 'present'
            return (
              <div key={cs.student_id} className="flex items-center gap-3 rounded-lg border bg-white px-4 py-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary shrink-0">
                  {cs.student?.name[0]}
                </div>
                <div className="flex-1 text-sm font-medium text-gray-900">{cs.student?.name}</div>
                {cs.student?.grade && (
                  <span className="text-xs text-gray-400">{cs.student.grade}</span>
                )}
                <div className="flex gap-1">
                  {STATUS_ORDER.map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatusMap((prev) => ({ ...prev, [cs.student_id]: s }))}
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                        status === s
                          ? STATUS_STYLE[s]
                          : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'
                      }`}
                    >
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {classStudents.length > 0 && (
        <div className="flex justify-end pt-1">
          <Button onClick={handleSave} disabled={saveAttendance.isPending} size="sm">
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {saveAttendance.isPending ? '저장 중...' : '출결 저장'}
          </Button>
        </div>
      )}
    </div>
  )
}
