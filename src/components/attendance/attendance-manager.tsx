'use client'

import { rosterAtDate } from '@/lib/week-roster'
import { useState } from 'react'
import { runOrReport } from '@/lib/async-ui'
import { useSettingsEditState } from '@/components/grade/settings-edit-state'
import { Check, CheckCheck, LoaderCircle, Save, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { ClassStudent } from '@/lib/types'
import { useAttendance, useSaveAttendance } from '@/hooks/use-attendance'

interface Props {
  recordedStudentIds?: string[]
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
  present: 'bg-[var(--share-blue-bg)] text-[var(--share-blue)] border-transparent hover:bg-muted',
  late: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
  absent: 'bg-red-100 text-red-700 border-red-200 hover:bg-red-200',
}

const STATUS_ORDER: AttendanceStatus[] = ['present', 'late', 'absent']

const KO_DAYS = ['일', '월', '화', '수', '목', '금', '토']

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

/** 목록에서 기준일과 가장 가까운 날짜 (순수 — 인자만 본다) */
function closestDate(dates: string[], target: string) {
  return dates.reduce((prev, cur) =>
    Math.abs(new Date(cur).getTime() - new Date(target).getTime()) <
    Math.abs(new Date(prev).getTime() - new Date(target).getTime()) ? cur : prev
  )
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

export function AttendanceManager({ classId, classStudents, defaultDate, scheduledDates, recordedStudentIds = [] }: Props) {
  const initDate = defaultDate ?? todayStr()
  const [date, setDate] = useState(initDate)
  const [statusMap, setStatusMap] = useState<Record<string, AttendanceStatus>>({})
  const [savedMap, setSavedMap] = useState<Record<string, AttendanceStatus>>({})

  const { data: records, isLoading, isError, refetch } = useAttendance(classId, date)
  const saveAttendance = useSaveAttendance(classId)

  const activeStudents = rosterAtDate(classStudents, date, [...(records ?? []).map(record => record.student_id), ...(date === defaultDate ? recordedStudentIds : [])])

  const changedStudents = activeStudents.filter(student => statusMap[student.student_id] !== savedMap[student.student_id])
  const dirty = changedStudents.length > 0
  const blocked = saveAttendance.isPending || isLoading || isError || records === undefined
  const recordByStudent = new Map(records?.map(record => [record.student_id, record]))
  const missingCount = activeStudents.filter(student => !statusMap[student.student_id]).length
  useSettingsEditState('attendance', dirty, saveAttendance.isPending)
  function changeDate(next: string) {
    if (saveAttendance.isPending || (dirty && !window.confirm('출결 변경을 저장하지 않고 날짜를 바꿀까요?'))) return
    setStatusMap({}); setSavedMap({}); setDate(next)
  }

  // 서버 출결이 도착/갱신되면 편집용 맵을 다시 만든다 — 렌더 중 조정.
  // (effect + exhaustive-deps 억제 주석이면 React Compiler 가 이 컴포넌트를 건너뛴다)
  // records 초기값은 sentinel(undefined): 쿼리 캐시가 따뜻한 채 재마운트(설정 닫았다 열기)하면
  // useState({ records, date }) 는 동기화를 건너뛰어 statusMap 이 빈 채로 남는다
  const [syncedRecords, setSyncedRecords] = useState<{ records: typeof records; date: string }>({ records: undefined, date })
  if (syncedRecords.records !== records || syncedRecords.date !== date) {
    setSyncedRecords({ records, date })
    if (records && (!dirty || syncedRecords.date !== date)) {
      const map: Record<string, AttendanceStatus> = {}
      records.forEach((r) => { map[r.student_id] = r.status })
      setStatusMap(map)
      setSavedMap(map)
    }
  }

  // 스케줄 기반 prev/next
  function prevDate() {
    if (scheduledDates) {
      const idx = scheduledDates.indexOf(date)
      if (idx > 0) changeDate(scheduledDates[idx - 1])
    } else {
      changeDate(offsetDate(date, -7))
    }
  }

  function nextDate() {
    if (scheduledDates) {
      const idx = scheduledDates.indexOf(date)
      if (idx < scheduledDates.length - 1) changeDate(scheduledDates[idx + 1])
    } else {
      changeDate(offsetDate(date, 7))
    }
  }

  const isFirst = scheduledDates ? scheduledDates.indexOf(date) <= 0 : false
  const isLast = scheduledDates
    ? scheduledDates.indexOf(date) >= scheduledDates.length - 1
    : date >= todayStr()

  // 스케줄 기반일 때 현재 날짜가 목록에 없으면 가장 가까운 날짜로 맞추기
  // 스케줄 목록이 바뀌었는데 현재 날짜가 목록에 없으면 기준일과 가장 가까운 날짜로 맞춘다 — 렌더 중 조정
  // 초기값은 sentinel(undefined): 재마운트 때도 마운트 직후 한 번 검사해 목록 밖 날짜를 보정한다
  const [syncedSchedule, setSyncedSchedule] = useState<typeof scheduledDates>(undefined)
  if (syncedSchedule !== scheduledDates) {
    setSyncedSchedule(scheduledDates)
    if (scheduledDates && scheduledDates.length > 0 && !scheduledDates.includes(date)) {
      setDate(closestDate(scheduledDates, initDate))
    }
  }

  async function handleSave() {
    if (blocked || !dirty) return
    const saved = { ...statusMap }
    await runOrReport(async () => {
      await saveAttendance.mutateAsync({
        date,
        records: changedStudents.map((cs) => ({
          student_id: cs.student_id,
          status: statusMap[cs.student_id],
          note: recordByStudent.get(cs.student_id)?.note ?? null,
        })),
      })
      setSavedMap(saved)
      toast.success('출결이 저장되었습니다')
    }, () => toast.error('저장 실패'))
  }

  const counts = { present: 0, late: 0, absent: 0 }
  activeStudents.forEach((cs) => { const status = statusMap[cs.student_id]; if (status) counts[status]++ })

  return (
    <div className="space-y-3">
      {/* 날짜 네비 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={prevDate} aria-label="이전 수업일" disabled={isFirst || saveAttendance.isPending || isLoading}>
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
              disabled={saveAttendance.isPending || isLoading}
              type="date"
              value={date}
              onChange={(e) => changeDate(e.target.value)}
              className="rounded-md border px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          )}

          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={nextDate} aria-label="다음 수업일" disabled={isLast || saveAttendance.isPending || isLoading}>
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

      {!isLoading && !isError && activeStudents.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2">
        <div className="text-xs text-muted-foreground">{missingCount > 0 ? `미기록 ${missingCount}명` : '전체 입력 완료'}<span className="ml-2">지각·결석만 아래에서 수정하세요.</span></div>
        <Button size="sm" variant="outline" disabled={blocked || missingCount === 0} onClick={() => setStatusMap(previous => ({...previous, ...Object.fromEntries(activeStudents.filter(student => !previous[student.student_id]).map(student => [student.student_id, 'present' as const]))}))}><CheckCheck aria-hidden="true" className="size-4" />미기록 모두 출석</Button>
      </div>}
      {/* 학생 목록 */}
      {isError ? <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">출결을 불러오지 못했습니다. <Button size="sm" variant="outline" onClick={() => void refetch()}>다시 조회</Button></div> : isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : activeStudents.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">수강 학생이 없어요</p>
      ) : (
        <div className="space-y-1.5">
          {activeStudents.map((cs) => {
            const status = statusMap[cs.student_id]
            return (
              <div key={cs.student_id} className="flex items-center gap-3 rounded-lg border bg-white px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{cs.student?.name}</div>
                  {recordByStudent.get(cs.student_id)?.note && <p className="mt-0.5 break-words text-xs text-muted-foreground">{recordByStudent.get(cs.student_id)?.note}</p>}
                </div>
                {!status && <span className="text-[11px] text-muted-foreground">미기록</span>}
                <div className="flex gap-1">
                  {STATUS_ORDER.map((s) => (
                    <button
                      key={s}
                      aria-label={`${cs.student?.name ?? '학생'} ${STATUS_LABEL[s]}`}
                      aria-pressed={status === s}
                      disabled={blocked}
                      onClick={() => setStatusMap((prev) => ({ ...prev, [cs.student_id]: s }))}
                      className={`inline-flex min-h-9 items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                        status === s
                          ? STATUS_STYLE[s]
                          : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'
                      }`}
                    >
                      {status === s && <Check aria-hidden="true" className="size-3" />}
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {activeStudents.length > 0 && (
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t bg-background py-3">
          <p role="status" className="text-xs text-muted-foreground">{saveAttendance.isPending ? '출결 저장 중…' : dirty ? `${changedStudents.length}명 변경 · 미저장` : missingCount > 0 ? `미기록 ${missingCount}명` : '출결 저장됨'}</p>
          <Button variant="action" onClick={handleSave} disabled={blocked || !dirty} size="sm">
            {saveAttendance.isPending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}
            {saveAttendance.isPending ? '저장 중…' : '출결 저장'}
          </Button>
        </div>
      )}
    </div>
  )
}
