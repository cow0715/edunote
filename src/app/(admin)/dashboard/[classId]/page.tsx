'use client'

import { use, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, UserPlus, UserMinus, RefreshCw, Link as LinkIcon, Plus, CheckCircle2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Class, ClassStudent, Student, Week } from '@/lib/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useClassStudents, useStudents, useAddClassStudent, useRemoveClassStudent } from '@/hooks/use-students'
import { useWeeks, useMoveWeekDate } from '@/hooks/use-weeks'
import { useSyncWeeks, useExtendWeeks, useClassPeriods, useCreateClassPeriod, useActivateClassPeriod } from '@/hooks/use-classes'
import { buildWeekDisplayMap, defaultPeriodLabel } from '@/lib/class-periods'

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
  weekLabelMap,
  onDateClick,
  onDrop,
}: {
  classStartDate: string
  classEndDate: string
  dateWeekMap: Map<string, string>
  weekLabelMap: Map<string, string>
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
          {weekLabelMap.get(draggingWeekId)} — 이동할 날짜에서 손을 떼세요
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
                  title={weekLabelMap.get(weekId)}
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
  const [extendCount, setExtendCount] = useState('4')
  const [periodForm, setPeriodForm] = useState({
    semester: '1',
    examType: 'final' as 'midterm' | 'final' | 'other',
    label: '1학기 기말',
    startDate: todayLocalStr(),
  })

  const { data: cls, isLoading: classLoading } = useQuery({
    queryKey: ['class', classId],
    queryFn: () => fetchClass(classId),
  })
  const { data: classStudents = [] } = useClassStudents(classId)
  const { data: allStudents = [] } = useStudents()
  const { data: weeks = [] } = useWeeks(classId)
  const { data: periods = [] } = useClassPeriods(classId)
  const addStudent = useAddClassStudent(classId)
  const removeStudent = useRemoveClassStudent(classId)
  const syncWeeks = useSyncWeeks(classId)
  const extendWeeks = useExtendWeeks(classId)
  const moveWeekDate = useMoveWeekDate(classId)
  const createPeriod = useCreateClassPeriod(classId)
  const activatePeriod = useActivateClassPeriod(classId)

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


  if (classLoading) return <div className="h-8 w-48 rounded bg-gray-100 animate-pulse" />
  if (!cls) return <p className="text-sm text-gray-500">수업을 찾을 수 없습니다</p>

  const scheduleDays = cls.schedule_days ?? []
  const scheduleLabel = scheduleDays.length > 0
    ? `주 ${scheduleDays.length}회 (${scheduleDays.map((d) => DAY_LABEL[d] ?? d).join('·')})`
    : '요일 미설정'

  const dateWeekMap = buildDateWeekMap(weeks as Week[])
  const weekDisplayMap = buildWeekDisplayMap(weeks as Week[], periods)
  const weekLabelMap = new Map<string, string>((weeks as Week[]).map((w) => [
    w.id,
    weekDisplayMap.get(w.id)?.displayLabel ?? `${w.week_number}주차`,
  ]))
  const currentPeriod = periods.find((p) => p.is_current)

  function updatePeriodType(semester: string, examType: 'midterm' | 'final' | 'other') {
    const sem = semester === '2' ? 2 : 1
    setPeriodForm((prev) => ({
      ...prev,
      semester,
      examType,
      label: defaultPeriodLabel(sem, examType),
    }))
  }

  function createCurrentPeriod() {
    createPeriod.mutate({
      label: periodForm.label,
      semester: periodForm.semester === '2' ? 2 : 1,
      exam_type: periodForm.examType,
      start_date: periodForm.startDate,
      is_current: true,
    })
  }

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

      <div className="mb-6 rounded-xl border bg-white p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">현재 학습 기간</h2>
            {currentPeriod ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {currentPeriod.label}
                </span>
                <span className="text-xs text-gray-400">
                  {currentPeriod.start_date}
                  {currentPeriod.end_date ? ` ~ ${currentPeriod.end_date}` : ' 이후'}
                </span>
              </div>
            ) : (
              <p className="mt-2 text-xs text-amber-500">현재 기간이 없습니다. 새 기간을 시작해 주세요.</p>
            )}
            {periods.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {periods.map((period) => (
                  <button
                    key={period.id}
                    type="button"
                    onClick={() => activatePeriod.mutate(period.id)}
                    disabled={period.is_current || activatePeriod.isPending}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      period.is_current
                        ? 'border-blue-200 bg-blue-50 text-blue-600'
                        : 'border-gray-200 text-gray-500 hover:border-blue-200 hover:text-blue-500'
                    }`}
                  >
                    {period.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-[100px_120px_1fr_140px_auto]">
            <Select
              value={periodForm.semester}
              onValueChange={(value) => updatePeriodType(value, periodForm.examType)}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1학기</SelectItem>
                <SelectItem value="2">2학기</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={periodForm.examType}
              onValueChange={(value) => updatePeriodType(periodForm.semester, value as 'midterm' | 'final' | 'other')}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="midterm">중간</SelectItem>
                <SelectItem value="final">기말</SelectItem>
                <SelectItem value="other">기타</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={periodForm.label}
              onChange={(e) => setPeriodForm((prev) => ({ ...prev, label: e.target.value }))}
              className="h-8"
            />
            <Input
              type="date"
              value={periodForm.startDate}
              onChange={(e) => setPeriodForm((prev) => ({ ...prev, startDate: e.target.value }))}
              className="h-8"
            />
            <Button
              size="sm"
              onClick={createCurrentPeriod}
              disabled={!periodForm.label || !periodForm.startDate || createPeriod.isPending}
            >
              {createPeriod.isPending ? '생성 중...' : '새 기간 시작'}
            </Button>
          </div>
        </div>
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
          {scheduleDays.length > 0 && weeks.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Select value={extendCount} onValueChange={setExtendCount}>
                <SelectTrigger size="sm" className="h-8 w-[84px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 4, 8, 12, 16].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}회</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => extendWeeks.mutate(parseInt(extendCount, 10))}
                disabled={extendWeeks.isPending}
              >
                {extendWeeks.isPending
                  ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  : <Plus className="mr-1.5 h-3.5 w-3.5" />}
                추가
              </Button>
            </div>
          )}
        </div>

        {weeks.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-500">아직 주차가 없어요</p>
            {scheduleDays.length === 0 && (
              <p className="mt-1 text-xs text-gray-400">수업 수정에서 요일을 설정하면 자동으로 생성됩니다</p>
            )}
            {scheduleDays.length > 0 && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => syncWeeks.mutate()} disabled={syncWeeks.isPending}>
                {syncWeeks.isPending && <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                주차 생성하기
              </Button>
            )}
          </div>
        ) : (
          <div className="relative">
            <ClassCalendar
              classStartDate={cls.start_date}
              classEndDate={cls.end_date}
              dateWeekMap={dateWeekMap}
              weekLabelMap={weekLabelMap}
              onDateClick={(weekId) => router.push(`/dashboard/${classId}/weeks/${weekId}`)}
              onDrop={(weekId, newDate) => moveWeekDate.mutate({ weekId, date: newDate })}
            />
            {moveWeekDate.isPending && (
              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-white/80 backdrop-blur-[2px]">
                <RefreshCw className="h-5 w-5 animate-spin text-primary" />
                <p className="mt-2 text-xs font-medium text-gray-500">주차 재정렬 중...</p>
              </div>
            )}
          </div>
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
