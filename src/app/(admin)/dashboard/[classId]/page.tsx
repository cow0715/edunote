'use client'

import { use, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, UserPlus, UserMinus, RefreshCw, Link as LinkIcon, AlertTriangle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Class, ClassStudent, Student, Week } from '@/lib/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useClassStudents, useStudents, useAddClassStudent, useRemoveClassStudent } from '@/hooks/use-students'
import { useWeeks, useMoveWeekDate } from '@/hooks/use-weeks'
import { useSyncWeeks } from '@/hooks/use-classes'

const DAY_LABEL: Record<string, string> = {
  mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일',
}
const DOW = ['일', '월', '화', '수', '목', '금', '토']

async function fetchClass(id: string): Promise<Class> {
  const res = await fetch(`/api/classes/${id}`)
  if (!res.ok) throw new Error('수업 정보를 불러올 수 없습니다')
  return res.json()
}

// 수업일 → weekId 맵 생성
// week.start_date는 수업일 자체 (generateSessionDates가 각 수업일을 별도 주차로 저장)
function buildDateWeekMap(weeks: Week[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const week of weeks) {
    if (week.start_date) map.set(week.start_date, week.id)
  }
  return map
}

function todayLocalStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── 달력 컴포넌트 (pointer events 드래그) ─────────────────────────────────────
function ClassCalendar({
  classStartDate,
  classEndDate,
  dateWeekMap,
  weekNumberMap,
  onDateClick,
  onDrop,
}: {
  classStartDate: string
  classEndDate: string
  dateWeekMap: Map<string, string>
  weekNumberMap: Map<string, number>
  onDateClick: (weekId: string) => void
  onDrop: (weekId: string, newDate: string) => void
}) {
  const [year, setYear] = useState(() => {
    const today = todayLocalStr()
    const s = classStartDate.slice(0, 10)
    const e = classEndDate.slice(0, 10)
    if (today >= s && today <= e) return new Date().getFullYear()
    return parseInt(classStartDate.slice(0, 4), 10)
  })
  const [month, setMonth] = useState(() => {
    const today = todayLocalStr()
    const s = classStartDate.slice(0, 10)
    const e = classEndDate.slice(0, 10)
    if (today >= s && today <= e) return new Date().getMonth() + 1
    return parseInt(classStartDate.slice(5, 7), 10)
  })

  // 드래그 상태: ref로 관리 (리렌더 최소화) + state로 UI 반영
  const draggingRef = useRef<string | null>(null)
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null)
  const [draggingWeekId, setDraggingWeekId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const minYear = parseInt(classStartDate.slice(0, 4), 10)
  const minMonth = parseInt(classStartDate.slice(5, 7), 10)
  const maxYear = parseInt(classEndDate.slice(0, 4), 10)
  const maxMonth = parseInt(classEndDate.slice(5, 7), 10)

  const canPrev = year > minYear || (year === minYear && month > minMonth)
  const canNext = year < maxYear || (year === maxYear && month < maxMonth)

  function prev() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function next() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  const daysInMonth = new Date(year, month, 0).getDate()
  const startDow = new Date(year, month - 1, 1).getDay()

  const cells: (number | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const toDateStr = (d: number) =>
    `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  const today = todayLocalStr()
  const rangeStart = classStartDate.slice(0, 10)
  const rangeEnd = classEndDate.slice(0, 10)

  // pointer move 중 드롭 대상 찾기
  function handlePointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return
    // 드래그로 간주할 최소 이동 거리
    if (pointerDownPos.current) {
      const dx = e.clientX - pointerDownPos.current.x
      const dy = e.clientY - pointerDownPos.current.y
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return
      pointerDownPos.current = null // 이후부터는 드래그 모드
      setDraggingWeekId(draggingRef.current)
    }
    // 현재 포인터 아래 data-date 요소 찾기
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const dateEl = el?.closest('[data-date]')
    setDropTarget(dateEl?.getAttribute('data-date') ?? null)
  }

  function handlePointerUp(e: React.PointerEvent, weekId: string) {
    const wasDragging = draggingRef.current && !pointerDownPos.current
    draggingRef.current = null
    pointerDownPos.current = null

    if (wasDragging) {
      // 드래그 완료 → 드롭 처리
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const dateEl = el?.closest('[data-date]')
      const newDate = dateEl?.getAttribute('data-date')
      if (newDate) onDrop(weekId, newDate)
    } else {
      // 클릭으로 처리
      onDateClick(weekId)
    }
    setDraggingWeekId(null)
    setDropTarget(null)
  }

  function cancelDrag() {
    draggingRef.current = null
    pointerDownPos.current = null
    setDraggingWeekId(null)
    setDropTarget(null)
  }

  return (
    <div
      onPointerMove={handlePointerMove}
      onPointerLeave={cancelDrag}
      style={{ touchAction: 'none' }}
    >
      {/* 드래그 안내 */}
      {draggingWeekId && (
        <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-600 text-center select-none">
          {weekNumberMap.get(draggingWeekId)}주차 — 이동할 날짜에서 손을 떼세요
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <button
          onClick={prev}
          disabled={!canPrev}
          className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-gray-100 transition-colors disabled:opacity-20"
        >
          <ChevronLeft className="h-4 w-4 text-gray-600" />
        </button>
        <p className="text-sm font-semibold text-gray-800">{year}년 {month}월</p>
        <button
          onClick={next}
          disabled={!canNext}
          className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-gray-100 transition-colors disabled:opacity-20"
        >
          <ChevronRight className="h-4 w-4 text-gray-600" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {DOW.map((d) => (
          <div key={d} className="pb-1 text-[10px] font-medium text-gray-400">{d}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />
          const dateStr = toDateStr(d)
          const weekId = dateWeekMap.get(dateStr)
          const isToday = dateStr === today
          const isInRange = dateStr >= rangeStart && dateStr <= rangeEnd
          const isDropTarget = dropTarget === dateStr
          const isDragging = weekId === draggingWeekId

          // 수업일 (파란 원) — 드래그 소스
          if (weekId) {
            return (
              <div key={d} className="flex items-center justify-center py-0.5">
                <div
                  data-weekid={weekId}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    draggingRef.current = weekId
                    pointerDownPos.current = { x: e.clientX, y: e.clientY }
                  }}
                  onPointerUp={(e) => handlePointerUp(e, weekId)}
                  title={`${weekNumberMap.get(weekId)}주차`}
                  className={`flex h-7 w-7 cursor-grab items-center justify-center rounded-full text-[11px] font-semibold transition-all select-none
                    bg-primary text-white
                    ${isDragging ? 'opacity-40 scale-90' : 'hover:bg-primary/80'}
                    ${isToday && !isDragging ? 'ring-2 ring-primary ring-offset-1' : ''}`}
                >
                  {d}
                </div>
              </div>
            )
          }

          // 수업 범위 내 빈 날짜 — 드롭 대상
          if (isInRange) {
            return (
              <div key={d} className="flex items-center justify-center py-0.5">
                <div
                  data-date={dateStr}
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] transition-all select-none
                    ${draggingWeekId
                      ? isDropTarget
                        ? 'bg-emerald-500 text-white scale-110 font-semibold'
                        : 'border border-dashed border-emerald-300 text-emerald-400'
                      : isToday
                        ? 'border border-primary/30 text-primary/60 font-medium'
                        : 'text-gray-300'
                    }`}
                >
                  {d}
                </div>
              </div>
            )
          }

          // 범위 밖
          return (
            <div key={d} className="flex items-center justify-center py-0.5">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px]
                ${isToday ? 'border border-primary text-primary font-semibold' : 'text-gray-200'}`}>
                {d}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function ClassDetailPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = use(params)
  const router = useRouter()
  const [addOpen, setAddOpen] = useState(false)
  const [addStep, setAddStep] = useState<{ studentId: string; name: string; joinedAt: string } | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ studentId: string; name: string; leftAt: string } | null>(null)
  const [syncWarning, setSyncWarning] = useState<{ message: string; affected_weeks: number[] } | null>(null)

  const { data: cls, isLoading: classLoading } = useQuery({
    queryKey: ['class', classId],
    queryFn: () => fetchClass(classId),
  })
  const { data: classStudents = [] } = useClassStudents(classId)
  const { data: allStudents = [] } = useStudents()
  const { data: weeks = [] } = useWeeks(classId)
  const addStudent = useAddClassStudent(classId)
  const removeStudent = useRemoveClassStudent(classId)
  const syncWeeks = useSyncWeeks(classId)
  const moveWeekDate = useMoveWeekDate(classId)

  const enrolledIds = new Set((classStudents as ClassStudent[]).map((cs) => cs.student_id))
  const unenrolled = (allStudents as Student[]).filter((s) => !enrolledIds.has(s.id))

  function handleRemoveClick(studentId: string, name: string) {
    setRemoveTarget({ studentId, name, leftAt: new Date().toISOString().slice(0, 10) })
  }

  function confirmRemove() {
    if (!removeTarget) return
    removeStudent.mutate({ studentId: removeTarget.studentId, left_at: removeTarget.leftAt })
    setRemoveTarget(null)
  }

  function confirmAdd() {
    if (!addStep) return
    addStudent.mutate({ student_id: addStep.studentId, joined_at: addStep.joinedAt })
    setAddStep(null)
    setAddOpen(false)
  }

  async function handleSync(force = false) {
    const result = await syncWeeks.mutateAsync(force)
    if (result?.warning) {
      setSyncWarning({ message: result.message, affected_weeks: result.affected_weeks })
    } else {
      setSyncWarning(null)
    }
  }

  if (classLoading) return <div className="h-8 w-48 rounded bg-gray-100 animate-pulse" />
  if (!cls) return <p className="text-sm text-gray-500">수업을 찾을 수 없습니다</p>

  const scheduleDays = cls.schedule_days ?? []
  const scheduleLabel = scheduleDays.length > 0
    ? `주 ${scheduleDays.length}회 (${scheduleDays.map((d) => DAY_LABEL[d] ?? d).join('·')})`
    : '요일 미설정'

  const dateWeekMap = buildDateWeekMap(weeks as Week[])
  const weekNumberMap = new Map<string, number>((weeks as Week[]).map((w) => [w.id, w.week_number]))

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard">
            <ChevronLeft className="h-4 w-4" />
            수업 목록
          </Link>
        </Button>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{cls.name}</h1>
        {cls.description && <p className="mt-1 text-sm text-gray-500">{cls.description}</p>}
        <p className="mt-1 text-xs text-gray-400">
          {new Date(cls.start_date).toLocaleDateString('ko-KR')} ~{' '}
          {new Date(cls.end_date).toLocaleDateString('ko-KR')}
          <span className="ml-2">{scheduleLabel}</span>
        </p>
      </div>

      {/* 학생 섹션 */}
      <div className="mb-6 rounded-xl border bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-800">
            학생 <span className="text-gray-400 font-normal">({classStudents.length})</span>
          </h2>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
            학생 추가
          </Button>
        </div>

        {classStudents.length === 0 ? (
          <p className="py-3 text-center text-xs text-gray-400">수강 학생이 없어요</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(classStudents as ClassStudent[]).map((cs) => (
              <div
                key={cs.id}
                className="group flex items-center gap-1.5 rounded-full border bg-gray-50 pl-1 pr-2 py-1 text-xs"
              >
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                  {cs.student?.name[0]}
                </div>
                <span className="text-gray-700 font-medium">{cs.student?.name}</span>
                {cs.student?.share_token && (
                  <button
                    onClick={() => window.open(`/share/${cs.student!.share_token}`, '_blank')}
                    className="text-blue-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="학부모 공유 페이지"
                  >
                    <LinkIcon className="h-3 w-3" />
                  </button>
                )}
                <button
                  onClick={() => handleRemoveClick(cs.student_id, cs.student?.name ?? '')}
                  className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <UserMinus className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 달력 섹션 */}
      <div className="rounded-xl border bg-white p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-800">수업 일정</h2>
          {scheduleDays.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleSync(false)}
              disabled={syncWeeks.isPending}
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncWeeks.isPending ? 'animate-spin' : ''}`} />
              주차 재생성
            </Button>
          )}
        </div>

        {/* 주차 재생성 경고 */}
        {syncWarning && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-800">{syncWarning.message}</p>
                <p className="mt-1 text-xs text-amber-600">
                  영향받는 주차: {syncWarning.affected_weeks.join(', ')}주차
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="destructive" onClick={() => handleSync(true)}>
                    삭제하고 재생성
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setSyncWarning(null)}>
                    취소
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {weeks.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-500">아직 주차가 없어요</p>
            {scheduleDays.length === 0 && (
              <p className="mt-1 text-xs text-gray-400">수업 수정에서 요일을 설정하면 자동으로 생성됩니다</p>
            )}
            {scheduleDays.length > 0 && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => handleSync(false)} disabled={syncWeeks.isPending}>
                주차 생성하기
              </Button>
            )}
          </div>
        ) : (
          <ClassCalendar
            classStartDate={cls.start_date}
            classEndDate={cls.end_date}
            dateWeekMap={dateWeekMap}
            weekNumberMap={weekNumberMap}
            onDateClick={(weekId) => router.push(`/dashboard/${classId}/weeks/${weekId}`)}
            onDrop={(weekId, newDate) => moveWeekDate.mutate({ weekId, date: newDate })}
          />
        )}

        {weeks.length > 0 && (
          <div className="mt-3 flex items-center gap-4 pt-3 border-t">
            <div className="flex items-center gap-1.5">
              <span className="flex h-4 w-4 rounded-full bg-primary" />
              <span className="text-[11px] text-gray-400">수업일 (클릭 이동 · 드래그로 날짜 변경)</span>
            </div>
          </div>
        )}
      </div>

      {/* 학생 추가 다이얼로그 */}
      <Dialog open={addOpen} onOpenChange={(v) => { setAddOpen(v); if (!v) setAddStep(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{addStep ? `${addStep.name} 입원 날짜` : '학생 추가'}</DialogTitle>
          </DialogHeader>
          {addStep ? (
            <div className="space-y-4 pt-1">
              <div className="space-y-2">
                <Label>입원일</Label>
                <Input
                  type="date"
                  value={addStep.joinedAt}
                  onChange={(e) => setAddStep({ ...addStep, joinedAt: e.target.value })}
                  className="w-full"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAddStep(null)}>이전</Button>
                <Button onClick={confirmAdd} disabled={!addStep.joinedAt || addStudent.isPending}>추가</Button>
              </div>
            </div>
          ) : unenrolled.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">
              추가할 수 있는 학생이 없어요.
              <br />먼저 학생 관리에서 학생을 등록해주세요.
            </p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {unenrolled.map((s) => (
                <button
                  key={s.id}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                  onClick={() => setAddStep({ studentId: s.id, name: s.name, joinedAt: new Date().toISOString().slice(0, 10) })}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {s.name[0]}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{s.name}</p>
                    {s.grade && <p className="text-xs text-gray-400">{s.grade}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 퇴원 확인 다이얼로그 */}
      <Dialog open={!!removeTarget} onOpenChange={(v) => { if (!v) setRemoveTarget(null) }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>{removeTarget?.name} 퇴원 처리</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-2">
              <Label>퇴원일</Label>
              <Input
                type="date"
                value={removeTarget?.leftAt ?? ''}
                onChange={(e) => setRemoveTarget((t) => t ? { ...t, leftAt: e.target.value } : null)}
                className="w-full"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRemoveTarget(null)}>취소</Button>
              <Button variant="destructive" onClick={confirmRemove} disabled={!removeTarget?.leftAt || removeStudent.isPending}>
                퇴원
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
