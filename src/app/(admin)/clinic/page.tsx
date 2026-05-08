'use client'

import { useState } from 'react'
import { AlertCircle, CalendarCheck, ChevronLeft, ChevronRight, Clock, Save, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useClinic, useClinicAttendance, useSaveClinicAttendance, useSaveClinicEnrollment, useSaveClinicSlots } from '@/hooks/use-clinic'
import { ClinicEnrollment, ClinicSlot, ClinicStudent, ClinicWeekday } from '@/lib/types'

const WEEKDAYS: { key: ClinicWeekday; label: string; full: string }[] = [
  { key: 'mon', label: '월', full: '월요일' },
  { key: 'tue', label: '화', full: '화요일' },
  { key: 'wed', label: '수', full: '수요일' },
  { key: 'thu', label: '목', full: '목요일' },
  { key: 'fri', label: '금', full: '금요일' },
  { key: 'sat', label: '토', full: '토요일' },
  { key: 'sun', label: '일', full: '일요일' },
]

const WEEKDAY_BY_INDEX: ClinicWeekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const WEEKDAY_ORDER = new Map(WEEKDAYS.map((day, index) => [day.key, index]))

type SlotDraft = {
  weekday: ClinicWeekday
  starts_at: string
  ends_at: string
  is_active: boolean
}

type AttendanceDraft = {
  date: string
  statuses: Record<string, 'present' | 'absent'>
}

type PendingEnrollmentChange = {
  student: ClinicStudent
  clinic_slot_id: string | null
  start_date: string
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function weekdayFromDate(date: string): ClinicWeekday {
  return WEEKDAY_BY_INDEX[new Date(`${date}T00:00:00`).getDay()]
}

function formatDate(date: string) {
  const d = new Date(`${date}T00:00:00`)
  const day = WEEKDAYS.find((item) => item.key === weekdayFromDate(date))?.label ?? ''
  return `${d.getMonth() + 1}/${d.getDate()} (${day})`
}

function formatTime(value: string | null | undefined) {
  return (value ?? '').slice(0, 5)
}

function buildDefaultSlots(slots: ClinicSlot[]): SlotDraft[] {
  const byDay = new Map(slots.map((slot) => [slot.weekday, slot]))
  return WEEKDAYS.map(({ key }) => {
    const slot = byDay.get(key)
    return {
      weekday: key,
      starts_at: formatTime(slot?.starts_at) || '18:00',
      ends_at: formatTime(slot?.ends_at) || '19:00',
      is_active: !!slot?.is_active,
    }
  })
}

function sortedSlots(slots: ClinicSlot[]) {
  return [...slots].sort((a, b) => (WEEKDAY_ORDER.get(a.weekday) ?? 0) - (WEEKDAY_ORDER.get(b.weekday) ?? 0))
}

function enrollmentMap(enrollments: ClinicEnrollment[]) {
  const map = new Map<string, ClinicEnrollment>()
  for (const enrollment of enrollments) {
    const current = map.get(enrollment.student_id)
    if (!current) {
      map.set(enrollment.student_id, enrollment)
      continue
    }
    if (!enrollment.end_date && current.end_date) {
      map.set(enrollment.student_id, enrollment)
      continue
    }
    if (enrollment.end_date === current.end_date && enrollment.start_date > current.start_date) {
      map.set(enrollment.student_id, enrollment)
    }
  }
  return map
}

function isEnrollmentEffectiveOn(enrollment: ClinicEnrollment, date: string) {
  return enrollment.start_date <= date && (!enrollment.end_date || enrollment.end_date > date)
}

function nextDateForWeekday(weekday: ClinicWeekday, baseDate = todayStr()) {
  for (let offset = 0; offset <= 6; offset += 1) {
    const candidate = addDays(baseDate, offset)
    if (weekdayFromDate(candidate) === weekday) return candidate
  }
  return baseDate
}

function findClinicDate(baseDate: string, direction: 1 | -1, activeWeekdays: Set<ClinicWeekday>) {
  for (let offset = 1; offset <= 70; offset += 1) {
    const candidate = addDays(baseDate, offset * direction)
    if (activeWeekdays.has(weekdayFromDate(candidate))) return candidate
  }
  return baseDate
}

function nextClinicFrom(date: string, slots: ClinicSlot[], enrollments: ClinicEnrollment[]) {
  const activeSlots = slots.filter((slot) => slot.is_active)
  for (let offset = 0; offset <= 70; offset += 1) {
    const candidate = addDays(date, offset)
    const weekday = weekdayFromDate(candidate)
    const slot = activeSlots.find((item) => item.weekday === weekday)
    if (!slot) continue
    return {
      date: candidate,
      slot,
      count: enrollments.filter((enrollment) => enrollment.clinic_slot_id === slot.id && isEnrollmentEffectiveOn(enrollment, candidate)).length,
    }
  }
  return null
}

export default function ClinicPage() {
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [slotDraftsState, setSlotDraftsState] = useState<SlotDraft[] | null>(null)
  const [attendanceDraft, setAttendanceDraft] = useState<AttendanceDraft | null>(null)
  const [pendingEnrollmentChange, setPendingEnrollmentChange] = useState<PendingEnrollmentChange | null>(null)

  const { data, isLoading } = useClinic()
  const saveSlots = useSaveClinicSlots()
  const saveEnrollment = useSaveClinicEnrollment()
  const { data: attendanceData, isLoading: attendanceLoading } = useClinicAttendance(selectedDate)
  const saveAttendance = useSaveClinicAttendance(selectedDate)

  const slots = data?.slots ?? []
  const enrollments = data?.enrollments ?? []
  const students = data?.students ?? []
  const activeSlots = sortedSlots(slots.filter((slot) => slot.is_active))
  const defaultSlotDrafts = buildDefaultSlots(slots)
  const slotDrafts = slotDraftsState ?? defaultSlotDrafts
  const hasSlotChanges = !!slotDraftsState && JSON.stringify(slotDraftsState) !== JSON.stringify(defaultSlotDrafts)
  const activeWeekdays = new Set(activeSlots.map((slot) => slot.weekday))
  const selectedSlot = attendanceData?.slot ?? null
  const enrollmentsByStudent = enrollmentMap(enrollments)
  const assignedStudentCount = enrollmentsByStudent.size
  const studentsById = new Map(students.map((student) => [student.id, student]))
  const attendanceEnrollments = attendanceData?.enrollments ?? []
  const targetEnrollments = selectedSlot
    ? attendanceEnrollments
    : []
  const targetStudents = targetEnrollments
    .map((enrollment) => studentsById.get(enrollment.student_id))
    .filter((student): student is ClinicStudent => !!student)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  const attendanceMap = new Map((attendanceData?.attendance ?? []).map((record) => [record.student_id, record.status]))
  const defaultAttendanceStatuses = Object.fromEntries(
    targetStudents.map((student) => [student.id, attendanceMap.get(student.id) ?? 'present'])
  ) as Record<string, 'present' | 'absent'>
  const attendanceStatuses = attendanceDraft?.date === selectedDate
    ? attendanceDraft.statuses
    : defaultAttendanceStatuses
  const todayClinic = nextClinicFrom(todayStr(), slots, enrollments)
  const todayAttendanceCount = todayStr() === selectedDate
    ? (attendanceData?.attendance ?? []).filter((record) => targetStudents.some((student) => student.id === record.student_id)).length
    : 0
  const todayNeedsAttendance = todayStr() === selectedDate && !!selectedSlot && targetStudents.length > 0 && todayAttendanceCount < targetStudents.length
  const enrolledCountBySlot = new Map<string, number>()
  for (const enrollment of enrollments.filter((item) => isEnrollmentEffectiveOn(item, todayStr()))) {
    enrolledCountBySlot.set(enrollment.clinic_slot_id, (enrolledCountBySlot.get(enrollment.clinic_slot_id) ?? 0) + 1)
  }
  const slotById = new Map(slots.map((slot) => [slot.id, slot]))
  const slotByWeekday = new Map(slots.map((slot) => [slot.weekday, slot]))

  function updateSlotDraft(weekday: ClinicWeekday, patch: Partial<SlotDraft>) {
    const base = slotDraftsState ?? defaultSlotDrafts
    setSlotDraftsState(base.map((slot) => slot.weekday === weekday ? { ...slot, ...patch } : slot))
  }

  function moveClinicDate(direction: 1 | -1) {
    if (activeWeekdays.size === 0) return
    setSelectedDate(findClinicDate(selectedDate, direction, activeWeekdays))
    setAttendanceDraft(null)
  }

  function changeAttendance(studentId: string, status: 'present' | 'absent') {
    setAttendanceDraft({
      date: selectedDate,
      statuses: { ...defaultAttendanceStatuses, ...(attendanceDraft?.date === selectedDate ? attendanceDraft.statuses : {}), [studentId]: status },
    })
  }

  function requestEnrollmentChange(student: ClinicStudent, clinicSlotId: string | null) {
    const enrollment = enrollmentsByStudent.get(student.id)
    if (enrollment?.clinic_slot_id === clinicSlotId) return

    if (!enrollment) {
      saveEnrollment.mutate({
        student_id: student.id,
        clinic_slot_id: clinicSlotId,
        start_date: todayStr(),
      })
      return
    }

    const nextSlot = clinicSlotId ? slotById.get(clinicSlotId) : null
    setPendingEnrollmentChange({
      student,
      clinic_slot_id: clinicSlotId,
      start_date: nextSlot ? nextDateForWeekday(nextSlot.weekday) : addDays(todayStr(), 1),
    })
  }

  async function confirmEnrollmentChange() {
    if (!pendingEnrollmentChange) return
    await saveEnrollment.mutateAsync({
      student_id: pendingEnrollmentChange.student.id,
      clinic_slot_id: pendingEnrollmentChange.clinic_slot_id,
      start_date: pendingEnrollmentChange.start_date,
    })
    setPendingEnrollmentChange(null)
  }

  async function handleSaveAttendance() {
    if (!selectedSlot) return
    await saveAttendance.mutateAsync({
      date: selectedDate,
      clinic_slot_id: selectedSlot.id,
      records: targetStudents.map((student) => ({
        student_id: student.id,
        status: attendanceStatuses[student.id] ?? 'present',
      })),
    })
    setAttendanceDraft(null)
  }

  if (isLoading) return <div className="h-8 w-48 animate-pulse rounded bg-gray-100" />

  return (
    <>
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">보충수업</h1>
          <p className="mt-1 text-sm text-gray-500">고정 요일 신청과 날짜별 출석만 정규 수업과 분리해서 관리합니다.</p>
        </div>
        {todayNeedsAttendance && (
          <div className="flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
            <AlertCircle className="h-3.5 w-3.5" />
            오늘 보충수업 출석 미저장
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <section className="rounded-2xl bg-white p-4 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
            <CalendarCheck className="h-4 w-4 text-blue-600" />
            다음 보충수업
          </div>
          <p className="mt-3 text-2xl font-black text-gray-950">
            {todayClinic ? formatDate(todayClinic.date) : '-'}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {todayClinic
              ? `${formatTime(todayClinic.slot.starts_at)}-${formatTime(todayClinic.slot.ends_at)} · ${todayClinic.count}명 예정`
              : '활성화된 보충수업 요일이 없습니다'}
          </p>
        </section>
        <section className="rounded-2xl bg-white p-4 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
            <Users className="h-4 w-4 text-blue-600" />
            신청 학생
          </div>
          <p className="mt-3 text-2xl font-black text-gray-950">{assignedStudentCount}명</p>
          <p className="mt-1 text-xs text-gray-500">재원 학생 {students.length}명 중 고정 요일 배정</p>
        </section>
        <section className="rounded-2xl bg-white p-4 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
            <Clock className="h-4 w-4 text-blue-600" />
            운영 요일
          </div>
          <p className="mt-3 text-2xl font-black text-gray-950">{activeSlots.length}일</p>
          <p className="mt-1 text-xs text-gray-500">
            {activeSlots.length > 0
              ? activeSlots.map((slot) => WEEKDAYS.find((day) => day.key === slot.weekday)?.label).join(', ')
              : '요일 설정 필요'}
          </p>
        </section>
      </div>

      <section className="rounded-2xl bg-white p-4 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-gray-950">요일 설정</h2>
            <p className="mt-0.5 text-xs text-gray-500">SMS 자동 알림을 고려해 시작/종료 시간을 함께 저장합니다.</p>
          </div>
          <Button
            size="sm"
            onClick={() => saveSlots.mutate(slotDrafts)}
            disabled={!hasSlotChanges || saveSlots.isPending}
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            요일 저장
          </Button>
        </div>
        <div className="grid gap-2 md:grid-cols-7">
          {slotDrafts.map((slot) => (
            <div
              key={slot.weekday}
              className={`rounded-xl border px-3 py-3 ${slot.is_active ? 'border-blue-100 bg-blue-50/40' : 'border-gray-100 bg-gray-50'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm font-black ${slot.is_active ? 'text-blue-700' : 'text-gray-500'}`}>
                  {WEEKDAYS.find((day) => day.key === slot.weekday)?.label}
                </span>
                <Switch
                  checked={slot.is_active}
                  onCheckedChange={(checked) => updateSlotDraft(slot.weekday, { is_active: checked })}
                />
              </div>
              <div className="mt-3 space-y-1.5">
                <Input
                  type="time"
                  value={slot.starts_at}
                  onChange={(e) => updateSlotDraft(slot.weekday, { starts_at: e.target.value })}
                  className="h-8 bg-white text-xs"
                />
                <Input
                  type="time"
                  value={slot.ends_at}
                  onChange={(e) => updateSlotDraft(slot.weekday, { ends_at: e.target.value })}
                  className="h-8 bg-white text-xs"
                />
              </div>
              <p className="mt-2 text-[11px] font-semibold text-gray-400">
                신청 {enrolledCountBySlot.get(slotByWeekday.get(slot.weekday)?.id ?? '') ?? 0}명
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
        <section className="rounded-2xl bg-white p-4 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <div className="mb-4">
            <h2 className="text-base font-bold text-gray-950">학생 배정</h2>
            <p className="mt-0.5 text-xs text-gray-500">재원 학생별 주 1회 보충수업 요일을 선택합니다.</p>
          </div>
          <div className="max-h-[620px] divide-y divide-gray-100 overflow-y-auto">
            {students.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-400">재원 학생이 없습니다.</p>
            ) : students.map((student) => {
              const enrollment = enrollmentsByStudent.get(student.id)
              const enrollmentSlot = enrollment ? slotById.get(enrollment.clinic_slot_id) : null
              const hasInactiveSelection = !!enrollmentSlot && !enrollmentSlot.is_active
              const startsInFuture = !!enrollment && enrollment.start_date > todayStr()
              const endsInFuture = !!enrollment?.end_date && enrollment.end_date > todayStr()
              return (
                <div key={student.id} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_180px] md:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-gray-900">{student.name}</p>
                    <p className="mt-0.5 truncate text-xs text-gray-400">
                      {[student.school, student.grade, student.classes.map((cls) => cls.name).join(', ')].filter(Boolean).join(' · ')}
                    </p>
                    {(startsInFuture || endsInFuture) && (
                      <p className="mt-1 text-[11px] font-bold text-blue-600">
                        {startsInFuture ? `${formatDate(enrollment.start_date)}부터 적용` : `${formatDate(enrollment.end_date!)}부터 해제`}
                      </p>
                    )}
                  </div>
                  <Select
                    value={enrollment?.clinic_slot_id ?? 'none'}
                    onValueChange={(value) => {
                      requestEnrollmentChange(student, value === 'none' ? null : value)
                    }}
                    disabled={saveEnrollment.isPending}
                  >
                    <SelectTrigger className="h-9 w-full bg-white">
                      <SelectValue placeholder="요일 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">신청 안 함</SelectItem>
                      {activeSlots.map((slot) => (
                        <SelectItem key={slot.id} value={slot.id}>
                          {WEEKDAYS.find((day) => day.key === slot.weekday)?.full} {formatTime(slot.starts_at)}
                        </SelectItem>
                      ))}
                      {hasInactiveSelection && enrollmentSlot && (
                        <SelectItem value={enrollmentSlot.id}>
                          {WEEKDAYS.find((day) => day.key === enrollmentSlot.weekday)?.full} 비활성
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )
            })}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-gray-950">출석 체크</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                {selectedSlot
                  ? `${formatDate(selectedDate)} · ${targetStudents.length}명 예정`
                  : `${formatDate(selectedDate)} · 보충수업 없음`}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => moveClinicDate(-1)} disabled={activeWeekdays.size === 0}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => { setSelectedDate(e.target.value); setAttendanceDraft(null) }}
                className="h-8 w-36 text-xs"
              />
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => moveClinicDate(1)} disabled={activeWeekdays.size === 0}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {attendanceLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />)}
            </div>
          ) : !selectedSlot ? (
            <p className="rounded-xl bg-gray-50 px-4 py-10 text-center text-sm text-gray-400">선택한 날짜에는 활성화된 보충수업이 없습니다.</p>
          ) : targetStudents.length === 0 ? (
            <p className="rounded-xl bg-gray-50 px-4 py-10 text-center text-sm text-gray-400">이 요일에 신청한 학생이 없습니다.</p>
          ) : (
            <>
              <div className="space-y-2">
                {targetStudents.map((student) => {
                  const status = attendanceStatuses[student.id] ?? 'present'
                  return (
                    <div key={student.id} className="flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-black text-blue-600">
                        {student.name[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-gray-900">{student.name}</p>
                        <p className="truncate text-[11px] text-gray-400">{student.classes.map((cls) => cls.name).join(', ')}</p>
                      </div>
                      <div className="flex rounded-lg bg-gray-50 p-1">
                        {(['present', 'absent'] as const).map((item) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => changeAttendance(student.id, item)}
                            className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
                              status === item
                                ? item === 'present'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-red-500 text-white'
                                : 'text-gray-400 hover:text-gray-700'
                            }`}
                          >
                            {item === 'present' ? '출석' : '결석'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-4 flex justify-end">
                <Button size="sm" onClick={handleSaveAttendance} disabled={saveAttendance.isPending}>
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  출석 저장
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
    <Dialog open={!!pendingEnrollmentChange} onOpenChange={(open) => { if (!open) setPendingEnrollmentChange(null) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>보충수업 변경 적용일</DialogTitle>
          <DialogDescription>
            적용일 전까지는 기존 요일의 출석 대상에 그대로 남습니다.
          </DialogDescription>
        </DialogHeader>
        {pendingEnrollmentChange && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-gray-50 p-4">
              <p className="text-sm font-bold text-gray-950">{pendingEnrollmentChange.student.name}</p>
              <p className="mt-1 text-xs text-gray-500">
                {(() => {
                  const current = enrollmentsByStudent.get(pendingEnrollmentChange.student.id)
                  const currentSlot = current ? slotById.get(current.clinic_slot_id) : null
                  const nextSlot = pendingEnrollmentChange.clinic_slot_id ? slotById.get(pendingEnrollmentChange.clinic_slot_id) : null
                  return `${currentSlot ? WEEKDAYS.find((day) => day.key === currentSlot.weekday)?.full : '신청 안 함'} → ${nextSlot ? WEEKDAYS.find((day) => day.key === nextSlot.weekday)?.full : '신청 안 함'}`
                })()}
              </p>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500" htmlFor="clinic-enrollment-start-date">
                적용 시작일
              </label>
              <Input
                id="clinic-enrollment-start-date"
                type="date"
                min={todayStr()}
                value={pendingEnrollmentChange.start_date}
                onChange={(e) => setPendingEnrollmentChange({ ...pendingEnrollmentChange, start_date: e.target.value })}
                className="mt-1 bg-white"
              />
              <p className="mt-2 text-xs text-gray-500">
                {pendingEnrollmentChange.start_date
                  ? `${formatDate(pendingEnrollmentChange.start_date)}부터 새 배정으로 출석부에 표시됩니다.`
                  : '적용 시작일을 선택하세요.'}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setPendingEnrollmentChange(null)}>
            취소
          </Button>
          <Button onClick={confirmEnrollmentChange} disabled={saveEnrollment.isPending || !pendingEnrollmentChange?.start_date}>
            변경 저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
