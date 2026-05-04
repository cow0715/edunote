'use client'

import { use, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Link as LinkIcon,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Class, ClassPeriod, ClassStudent, Student, Week } from '@/lib/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useClassStudents, useStudents, useAddClassStudent, useRemoveClassStudent } from '@/hooks/use-students'
import { useWeeks, useMoveWeekDate } from '@/hooks/use-weeks'
import {
  useActivateClassPeriod,
  useClassPeriods,
  useCreateClassPeriod,
  useDeleteClassPeriod,
  useExtendWeeks,
  useSyncWeeks,
  useUpdateClassPeriod,
} from '@/hooks/use-classes'
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

function dateKeyToDay(date: string) {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return DOW[d.getDay()]
}

function dateKeyToScheduleDay(date: string) {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()]
}

function formatDateWithDay(date?: string | null) {
  if (!date) return ''
  const day = dateKeyToDay(date)
  return day ? `${date} (${day})` : date
}

function previousDate(date: string) {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function examTypeLabel(type: ClassPeriod['exam_type']) {
  if (type === 'midterm') return '중간'
  if (type === 'final') return '기말'
  return '기타'
}

function nextPeriodPreset(currentPeriod?: ClassPeriod) {
  if (!currentPeriod) return { semester: '1', examType: 'midterm' as const }
  if (currentPeriod.semester === 1 && currentPeriod.exam_type === 'midterm') return { semester: '1', examType: 'final' as const }
  if (currentPeriod.semester === 1) return { semester: '2', examType: 'midterm' as const }
  if (currentPeriod.exam_type === 'midterm') return { semester: '2', examType: 'final' as const }
  return { semester: '2', examType: 'other' as const }
}

type PeriodDraft = {
  periodId: string
  semester: string
  examType: ClassPeriod['exam_type']
  label: string
  startDate: string
  endDate: string
  isCurrent: boolean
}

type ClassVocabExportWord = {
  id: string
  week_id: string
  number: number
  passage_label: string | null
  english_word: string
  part_of_speech: string | null
  correct_answer: string | null
  synonyms: string[] | null
  antonyms: string[] | null
  derivatives: string | null
  example_sentence: string | null
  example_translation: string | null
}

type ClassVocabExportData = {
  weeks: Pick<Week, 'id' | 'class_id' | 'week_number' | 'start_date'>[]
  words: ClassVocabExportWord[]
}

function csvEscape(value: unknown) {
  const text = Array.isArray(value) ? value.join(', ') : String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'vocab'
}

function formatVocabList(values: string[] | null | undefined) {
  return (values ?? []).filter(Boolean).join(', ')
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
  const [periodWizardOpen, setPeriodWizardOpen] = useState(false)
  const [periodEdit, setPeriodEdit] = useState<PeriodDraft | null>(null)
  const [deletePeriodTarget, setDeletePeriodTarget] = useState<ClassPeriod | null>(null)
  const [activatePeriodTarget, setActivatePeriodTarget] = useState<ClassPeriod | null>(null)
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
  const updatePeriod = useUpdateClassPeriod(classId)
  const deletePeriod = useDeleteClassPeriod(classId)

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

  const className = cls.name
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
  const orderedPeriods = [...periods].sort((a, b) =>
    a.start_date.localeCompare(b.start_date) ||
    a.sort_order - b.sort_order
  )
  const sortedClassWeeks = (weeks as Week[])
    .filter((week) => !!week.start_date)
    .sort((a, b) =>
      (a.start_date ?? '').localeCompare(b.start_date ?? '') ||
      a.week_number - b.week_number
    )

  function getPeriodImpact(startDate: string) {
    const selectedDayKey = dateKeyToScheduleDay(startDate)
    const isScheduleDay = !selectedDayKey || scheduleDays.length === 0 || scheduleDays.includes(selectedDayKey)
    const firstWeek = sortedClassWeeks.find((week) => (week.start_date ?? '') >= startDate)
    const previousWeek = [...sortedClassWeeks].reverse().find((week) => (week.start_date ?? '') < startDate)
    const includedCount = sortedClassWeeks.filter((week) => (week.start_date ?? '') >= startDate).length

    return {
      dayLabel: dateKeyToDay(startDate),
      isGeneratedLesson: dateWeekMap.has(startDate),
      isScheduleDay,
      firstWeek,
      previousWeek,
      includedCount,
      duplicatePeriod: orderedPeriods.find((period) => period.start_date === startDate),
    }
  }

  function suggestedStartDate() {
    const today = todayLocalStr()
    return sortedClassWeeks.find((week) => (week.start_date ?? '') >= today)?.start_date ?? today
  }

  const periodImpact = getPeriodImpact(periodForm.startDate)
  const periodStartNotAfterCurrent = !!currentPeriod && periodForm.startDate <= currentPeriod.start_date
  const quickStartWeeks = sortedClassWeeks.filter((week) => (week.start_date ?? '') >= todayLocalStr()).slice(0, 6)

  function updatePeriodType(semester: string, examType: 'midterm' | 'final' | 'other') {
    const sem = semester === '2' ? 2 : 1
    setPeriodForm((prev) => ({
      ...prev,
      semester,
      examType,
      label: defaultPeriodLabel(sem, examType),
    }))
  }

  function updateEditPeriodType(semester: string, examType: 'midterm' | 'final' | 'other') {
    const sem = semester === '2' ? 2 : 1
    setPeriodEdit((prev) => prev
      ? { ...prev, semester, examType, label: defaultPeriodLabel(sem, examType) }
      : prev
    )
  }

  function openCreatePeriod() {
    const preset = nextPeriodPreset(currentPeriod)
    const semester = preset.semester
    const examType = preset.examType
    setPeriodForm({
      semester,
      examType,
      label: defaultPeriodLabel(semester === '2' ? 2 : 1, examType),
      startDate: suggestedStartDate(),
    })
    setPeriodWizardOpen(true)
  }

  function openEditPeriod(period: ClassPeriod) {
    setPeriodEdit({
      periodId: period.id,
      semester: String(period.semester),
      examType: period.exam_type,
      label: period.label,
      startDate: period.start_date,
      endDate: period.end_date ?? '',
      isCurrent: period.is_current,
    })
  }

  function createCurrentPeriod() {
    createPeriod.mutate({
      label: periodForm.label,
      semester: periodForm.semester === '2' ? 2 : 1,
      exam_type: periodForm.examType,
      start_date: periodForm.startDate,
      is_current: true,
    }, {
      onSuccess: () => setPeriodWizardOpen(false),
    })
  }

  function savePeriodEdit() {
    if (!periodEdit) return
    updatePeriod.mutate({
      periodId: periodEdit.periodId,
      label: periodEdit.label,
      semester: periodEdit.semester === '2' ? 2 : 1,
      exam_type: periodEdit.examType,
      start_date: periodEdit.startDate,
      end_date: periodEdit.endDate || null,
      is_current: periodEdit.isCurrent ? true : undefined,
    }, {
      onSuccess: () => setPeriodEdit(null),
    })
  }

  function confirmActivatePeriod() {
    if (!activatePeriodTarget) return
    activatePeriod.mutate(activatePeriodTarget.id, {
      onSuccess: () => setActivatePeriodTarget(null),
    })
  }

  function confirmDeletePeriod() {
    if (!deletePeriodTarget) return
    deletePeriod.mutate(deletePeriodTarget.id, {
      onSuccess: () => setDeletePeriodTarget(null),
    })
  }

  async function loadClassVocabExport() {
    const res = await fetch(`/api/classes/${classId}/vocab-words`)
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '단어장을 불러올 수 없습니다')
    return res.json() as Promise<ClassVocabExportData>
  }

  function getExportVocabRows(data: ClassVocabExportData) {
    const exportWeekIds = new Set(
      currentPeriod
        ? sortedClassWeeks
            .filter((week) => {
              const startDate = week.start_date ?? ''
              return startDate >= currentPeriod.start_date && (!currentPeriod.end_date || startDate <= currentPeriod.end_date)
            })
            .map((week) => week.id)
        : sortedClassWeeks.map((week) => week.id)
    )
    const weekById = new Map(data.weeks.map((week) => [week.id, week]))
    return data.words
      .filter((word) => exportWeekIds.has(word.week_id))
      .map((word) => {
        const week = weekById.get(word.week_id)
        const display = week ? weekDisplayMap.get(week.id)?.displayLabel ?? `${week.week_number}주차` : ''
        return { word, week, display }
      })
      .sort((a, b) =>
        (a.week?.start_date ?? '').localeCompare(b.week?.start_date ?? '') ||
        (a.week?.week_number ?? 0) - (b.week?.week_number ?? 0) ||
        a.word.number - b.word.number
      )
  }

  async function downloadClassVocabCsv() {
    try {
      const data = await loadClassVocabExport()
      const rows = getExportVocabRows(data)
      if (rows.length === 0) {
        window.alert('다운로드할 단어장이 없습니다.')
        return
      }
      const header = ['주차', '수업일', '지문', '번호', '본문 단어', '품사', '본문 의미', '문맥 동의어', '반의어', '파생어/변형 주의', '예문', '예문 해석']
      const csvRows = rows.map(({ word, week, display }) => [
        display,
        week?.start_date ?? '',
        word.passage_label ?? '',
        word.number,
        word.english_word,
        word.part_of_speech ?? '',
        word.correct_answer ?? '',
        formatVocabList(word.synonyms),
        formatVocabList(word.antonyms),
        word.derivatives ?? '',
        word.example_sentence ?? '',
        word.example_translation ?? '',
      ].map(csvEscape).join(','))
      const csv = ['\uFEFF' + header.map(csvEscape).join(','), ...csvRows].join('\r\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = sanitizeFileName(`${className}_${currentPeriod?.label ?? '전체'}_단어장`) + '.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '단어장 다운로드에 실패했습니다.')
    }
  }

  async function printClassVocab() {
    try {
      const data = await loadClassVocabExport()
      const rows = getExportVocabRows(data)
      if (rows.length === 0) {
        window.alert('인쇄할 단어장이 없습니다.')
        return
      }
      const title = `${className} ${currentPeriod?.label ?? '전체'} 단어장`
      const htmlRows = rows.map(({ word, week, display }) => `
        <tr>
          <td>${escapeHtml(display)}</td>
          <td>${escapeHtml(week?.start_date ?? '')}</td>
          <td>${escapeHtml(word.passage_label ?? '')}</td>
          <td>${escapeHtml(word.number)}</td>
          <td class="word">${escapeHtml(word.english_word)}</td>
          <td>${escapeHtml(word.part_of_speech ?? '')}</td>
          <td>${escapeHtml(word.correct_answer ?? '')}</td>
          <td>${escapeHtml(formatVocabList(word.synonyms))}</td>
          <td>${escapeHtml(formatVocabList(word.antonyms))}</td>
          <td>${escapeHtml(word.derivatives ?? '')}</td>
        </tr>
      `).join('')
      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        window.alert('팝업을 허용한 뒤 다시 시도해 주세요.')
        return
      }
      printWindow.document.write(`
        <!doctype html>
        <html lang="ko">
          <head>
            <meta charset="utf-8" />
            <title>${escapeHtml(title)}</title>
            <style>
              body { font-family: Arial, "Noto Sans KR", sans-serif; margin: 24px; color: #111827; }
              h1 { margin: 0 0 6px; font-size: 22px; }
              p { margin: 0 0 18px; color: #6b7280; font-size: 12px; }
              table { width: 100%; border-collapse: collapse; font-size: 11px; }
              th, td { border: 1px solid #e5e7eb; padding: 6px 7px; vertical-align: top; }
              th { background: #eff6ff; color: #1d4ed8; text-align: left; }
              .word { font-weight: 700; color: #111827; }
              @media print { body { margin: 12mm; } }
            </style>
          </head>
          <body>
            <h1>${escapeHtml(title)}</h1>
            <p>${rows.length}개 단어</p>
            <table>
              <thead>
                <tr>
                  <th>주차</th><th>수업일</th><th>지문</th><th>번호</th><th>본문 단어</th><th>품사</th><th>본문 의미</th><th>문맥 동의어</th><th>반의어</th><th>파생어/변형 주의</th>
                </tr>
              </thead>
              <tbody>${htmlRows}</tbody>
            </table>
          </body>
        </html>
      `)
      printWindow.document.close()
      printWindow.focus()
      printWindow.print()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '단어장 인쇄에 실패했습니다.')
    }
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

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{cls.name}</h1>
          {cls.description && <p className="mt-1 text-sm text-gray-500">{cls.description}</p>}
          <p className="mt-1 text-xs text-gray-400">
            {new Date(cls.start_date).toLocaleDateString('ko-KR')} ~{' '}
            {new Date(cls.end_date).toLocaleDateString('ko-KR')}
            <span className="ml-2">{scheduleLabel}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={downloadClassVocabCsv}>
            <Download className="h-4 w-4" />
            단어장 CSV
          </Button>
          <Button variant="outline" size="sm" onClick={printClassVocab}>
            <Printer className="h-4 w-4" />
            단어장 인쇄
          </Button>
        </div>
      </div>

      <div className="mb-6 rounded-3xl bg-white p-5 shadow-[0_10px_40px_rgba(0,75,198,0.03)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-gray-900">학습 기간 관리</h2>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-600">
                SHARE 표시 기준
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              기간은 데이터를 지우는 기능이 아니라, 학부모 공유 화면에서 어떤 시험 범위의 성적·오답·과제를 보여줄지 정하는 기준입니다.
            </p>

            {currentPeriod ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-bold text-blue-600">
                  <CheckCircle2 className="h-4 w-4" />
                  현재 {currentPeriod.label}
                </span>
                <span className="text-xs font-medium text-gray-400">
                  {formatDateWithDay(currentPeriod.start_date)}
                  {currentPeriod.end_date ? ` ~ ${formatDateWithDay(currentPeriod.end_date)}` : ' 이후'}
                </span>
              </div>
            ) : (
              <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                현재 기간이 없습니다. 새 기간을 시작하면 SHARE 기본 화면이 정해집니다.
              </div>
            )}
          </div>

          <Button
            onClick={openCreatePeriod}
            className="h-10 rounded-full px-4"
          >
            <Plus className="h-4 w-4" />
            새 시험 기간 시작
          </Button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl bg-blue-50 px-4 py-3">
            <p className="text-xs font-bold text-blue-600">SHARE 기본 화면</p>
            <p className="mt-1 text-xs leading-5 text-gray-600">현재 기간의 성적, 오답, 단어, 과제, 취약분석만 보여줍니다.</p>
          </div>
          <div className="rounded-2xl bg-gray-50 px-4 py-3">
            <p className="text-xs font-bold text-gray-700">수업 목록 주차</p>
            <p className="mt-1 text-xs leading-5 text-gray-500">선택한 시작일 이후 수업이 새 기간 1주차부터 다시 표시됩니다.</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 px-4 py-3">
            <p className="text-xs font-bold text-emerald-700">누적 데이터</p>
            <p className="mt-1 text-xs leading-5 text-gray-600">출결과 누적 습관 지표는 같은 반 안에서 계속 이어집니다.</p>
          </div>
        </div>

        {orderedPeriods.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-gray-700">기간 목록</p>
              <p className="text-[11px] text-gray-400">잘못 만들었으면 수정하거나 이전 기간으로 되돌릴 수 있습니다.</p>
            </div>
            <div className="space-y-2">
              {orderedPeriods.map((period) => (
                <div
                  key={period.id}
                  className={`flex flex-col gap-3 rounded-2xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                    period.is_current ? 'bg-blue-50' : 'bg-gray-50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm font-bold ${period.is_current ? 'text-blue-700' : 'text-gray-800'}`}>
                        {period.label}
                      </p>
                      {period.is_current && (
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-blue-600">현재</span>
                      )}
                      <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                        {period.semester}학기 · {examTypeLabel(period.exam_type)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {formatDateWithDay(period.start_date)}
                      {period.end_date ? ` ~ ${formatDateWithDay(period.end_date)}` : ' 이후'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {!period.is_current && (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => setActivatePeriodTarget(period)}
                        disabled={activatePeriod.isPending}
                        className="rounded-full bg-white"
                      >
                        <RotateCcw className="h-3 w-3" />
                        현재로
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => openEditPeriod(period)}
                      title="기간 수정"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => setDeletePeriodTarget(period)}
                      disabled={period.is_current || deletePeriod.isPending}
                      title={period.is_current ? '현재 기간은 다른 기간을 현재로 바꾼 뒤 삭제할 수 있습니다' : '기간 삭제'}
                      className="text-red-500 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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

      {/* 새 기간 시작 다이얼로그 */}
      <Dialog open={periodWizardOpen} onOpenChange={setPeriodWizardOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>새 시험 기간 시작</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 pt-1">
            <div className="rounded-2xl bg-blue-50 px-4 py-3">
              <p className="text-sm font-bold text-blue-700">이 작업은 데이터를 지우지 않습니다.</p>
              <p className="mt-1 text-xs leading-5 text-gray-600">
                선택한 시작일 이후 수업만 새 기간 성적·오답·과제 분석에 들어갑니다. 출결과 누적 습관 지표는 같은 반 안에서 계속 이어집니다.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>학기</Label>
                <Select
                  value={periodForm.semester}
                  onValueChange={(value) => updatePeriodType(value, periodForm.examType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1학기</SelectItem>
                    <SelectItem value="2">2학기</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>시험 구분</Label>
                <Select
                  value={periodForm.examType}
                  onValueChange={(value) => updatePeriodType(periodForm.semester, value as 'midterm' | 'final' | 'other')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="midterm">중간</SelectItem>
                    <SelectItem value="final">기말</SelectItem>
                    <SelectItem value="other">기타</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>기간 이름</Label>
                <Input
                  value={periodForm.label}
                  onChange={(e) => setPeriodForm((prev) => ({ ...prev, label: e.target.value }))}
                  placeholder="예: 1학기 기말"
                />
              </div>
              <div className="space-y-2">
                <Label>시작 날짜</Label>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={periodForm.startDate}
                    onChange={(e) => setPeriodForm((prev) => ({ ...prev, startDate: e.target.value }))}
                  />
                  <div className="flex h-9 min-w-16 items-center justify-center rounded-md bg-gray-50 px-3 text-xs font-bold text-gray-600">
                    {periodImpact.dayLabel || '요일'}
                  </div>
                </div>
              </div>
            </div>

            {(quickStartWeeks.length > 0 || sortedClassWeeks.length > 0) && (
              <div>
                <p className="mb-2 text-xs font-bold text-gray-700">수업일 빠른 선택</p>
                <div className="flex flex-wrap gap-1.5">
                  {(quickStartWeeks.length > 0 ? quickStartWeeks : sortedClassWeeks.slice(-6)).map((week) => (
                    <button
                      key={week.id}
                      type="button"
                      onClick={() => setPeriodForm((prev) => ({ ...prev, startDate: week.start_date ?? prev.startDate }))}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                        periodForm.startDate === week.start_date
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-50 text-gray-600 hover:bg-blue-50 hover:text-blue-600'
                      }`}
                    >
                      {formatDateWithDay(week.start_date)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {!periodImpact.isScheduleDay && (
                <div className="flex gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  이 날짜는 이 반의 수업 요일이 아닙니다. 날짜가 맞다면 괜찮지만, 보통은 실제 첫 수업일을 선택하는 편이 안전합니다.
                </div>
              )}
              {!periodImpact.isGeneratedLesson && periodImpact.firstWeek && (
                <div className="flex gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  선택한 날짜에 생성된 수업 주차가 없습니다. 실제 첫 반영 주차는 {formatDateWithDay(periodImpact.firstWeek.start_date)}입니다.
                </div>
              )}
              {periodImpact.duplicatePeriod && (
                <div className="flex gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  같은 시작일의 기간이 이미 있습니다: {periodImpact.duplicatePeriod.label}
                </div>
              )}
              {periodStartNotAfterCurrent && (
                <div className="flex gap-2 rounded-2xl bg-red-50 px-4 py-3 text-xs leading-5 text-red-600">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  새 기간의 시작일은 현재 기간 시작일보다 뒤여야 합니다. 현재 기간 날짜를 고치려는 경우에는 기간 목록에서 현재 기간을 수정해 주세요.
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-gray-50 px-4 py-4">
              <div className="mb-3 flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-blue-600" />
                <p className="text-sm font-bold text-gray-800">확정하면 이렇게 바뀝니다</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] font-bold text-gray-500">이전 현재 기간</p>
                  <p className="mt-1 text-xs leading-5 text-gray-700">
                    {currentPeriod
                      ? `${currentPeriod.label}은 ${formatDateWithDay(previousDate(periodForm.startDate))}까지로 정리됩니다.`
                      : '새 기간이 현재 기간이 됩니다.'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-gray-500">첫 주차 표시</p>
                  <p className="mt-1 text-xs leading-5 text-gray-700">
                    {periodImpact.firstWeek
                      ? `${formatDateWithDay(periodImpact.firstWeek.start_date)} 수업이 ${periodForm.label} 1주차가 됩니다.`
                      : '이 날짜 이후 생성된 수업이 없어 SHARE에 새 기간 성적이 아직 보이지 않습니다.'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-gray-500">SHARE 표시</p>
                  <p className="mt-1 text-xs leading-5 text-gray-700">
                    오답·성적·단어·과제는 {periodForm.label} 기준 {periodImpact.includedCount}회 수업만 반영됩니다.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPeriodWizardOpen(false)}>취소</Button>
              <Button
                onClick={createCurrentPeriod}
                disabled={!periodForm.label || !periodForm.startDate || periodStartNotAfterCurrent || !!periodImpact.duplicatePeriod || createPeriod.isPending}
              >
                {createPeriod.isPending ? '시작 중...' : '이대로 시작'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 기간 수정 다이얼로그 */}
      <Dialog open={!!periodEdit} onOpenChange={(v) => { if (!v) setPeriodEdit(null) }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>기간 수정</DialogTitle>
          </DialogHeader>
          {periodEdit && (() => {
            const editImpact = getPeriodImpact(periodEdit.startDate)
            return (
              <div className="space-y-4 pt-1">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>학기</Label>
                    <Select
                      value={periodEdit.semester}
                      onValueChange={(value) => updateEditPeriodType(value, periodEdit.examType)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1학기</SelectItem>
                        <SelectItem value="2">2학기</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>시험 구분</Label>
                    <Select
                      value={periodEdit.examType}
                      onValueChange={(value) => updateEditPeriodType(periodEdit.semester, value as 'midterm' | 'final' | 'other')}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="midterm">중간</SelectItem>
                        <SelectItem value="final">기말</SelectItem>
                        <SelectItem value="other">기타</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>기간 이름</Label>
                    <Input
                      value={periodEdit.label}
                      onChange={(e) => setPeriodEdit((prev) => prev ? { ...prev, label: e.target.value } : prev)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>시작 날짜</Label>
                    <div className="flex gap-2">
                      <Input
                        type="date"
                        value={periodEdit.startDate}
                        onChange={(e) => setPeriodEdit((prev) => prev ? { ...prev, startDate: e.target.value } : prev)}
                      />
                      <div className="flex h-9 min-w-16 items-center justify-center rounded-md bg-gray-50 px-3 text-xs font-bold text-gray-600">
                        {editImpact.dayLabel || '요일'}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>종료 날짜</Label>
                    <Input
                      type="date"
                      value={periodEdit.endDate}
                      onChange={(e) => setPeriodEdit((prev) => prev ? { ...prev, endDate: e.target.value } : prev)}
                    />
                    <p className="text-[11px] text-gray-400">현재 진행 중인 기간은 종료 날짜를 비워두면 됩니다.</p>
                  </div>
                </div>

                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                  <p className="text-xs font-bold text-gray-700">수정 후 표시 미리보기</p>
                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    {editImpact.firstWeek
                      ? `${formatDateWithDay(editImpact.firstWeek.start_date)} 수업부터 ${periodEdit.label} 1주차로 계산됩니다.`
                      : '이 날짜 이후 생성된 수업이 없어 이 기간에 포함될 주차가 아직 없습니다.'}
                  </p>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setPeriodEdit(null)}>취소</Button>
                  <Button
                    onClick={savePeriodEdit}
                    disabled={!periodEdit.label || !periodEdit.startDate || updatePeriod.isPending}
                  >
                    {updatePeriod.isPending ? '저장 중...' : '수정 저장'}
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* 기간 전환 확인 다이얼로그 */}
      <Dialog open={!!activatePeriodTarget} onOpenChange={(v) => { if (!v) setActivatePeriodTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>현재 기간으로 바꿀까요?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="rounded-2xl bg-blue-50 px-4 py-3">
              <p className="text-sm font-bold text-blue-700">{activatePeriodTarget?.label}</p>
              <p className="mt-1 text-xs leading-5 text-gray-600">
                잘못 만든 기간을 되돌릴 때 사용하세요. 바꾸면 SHARE 기본 화면이 이 기간 기준으로 다시 계산되고, 데이터는 삭제되지 않습니다.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setActivatePeriodTarget(null)}>취소</Button>
              <Button onClick={confirmActivatePeriod} disabled={activatePeriod.isPending}>
                {activatePeriod.isPending ? '변경 중...' : '현재로 변경'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 기간 삭제 확인 다이얼로그 */}
      <Dialog open={!!deletePeriodTarget} onOpenChange={(v) => { if (!v) setDeletePeriodTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>기간을 삭제할까요?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="rounded-2xl bg-red-50 px-4 py-3">
              <p className="text-sm font-bold text-red-600">{deletePeriodTarget?.label}</p>
              <p className="mt-1 text-xs leading-5 text-gray-600">
                기간 기록만 삭제됩니다. 주차, 성적, 오답, 출결 데이터는 삭제되지 않지만 SHARE의 지난 기록 선택에서는 이 기간이 사라집니다.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeletePeriodTarget(null)}>취소</Button>
              <Button variant="destructive" onClick={confirmDeletePeriod} disabled={deletePeriod.isPending}>
                {deletePeriod.isPending ? '삭제 중...' : '삭제'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
