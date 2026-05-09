import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import type { ClinicAttendance, ClinicEnrollment, ClinicSlot } from '@/lib/types'

const WEEKDAY_BY_INDEX = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

type ClinicEnrollmentRow = ClinicEnrollment & { clinic_slot: ClinicSlot | ClinicSlot[] | null }
type StudentRow = { id: string; name: string }

function dateStr(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return dateStr(d)
}

function todayStr() {
  return dateStr(new Date())
}

function weekdayFromDate(date: string) {
  return WEEKDAY_BY_INDEX[new Date(`${date}T00:00:00`).getDay()]
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const daysParam = Number(new URL(request.url).searchParams.get('days') ?? 56)
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(Math.floor(daysParam), 7), 180) : 56
  const today = todayStr()
  const fromDate = addDays(today, -(days - 1))

  const [
    { data: enrollments, error: enrollmentError },
    { data: attendance, error: attendanceError },
    { data: students, error: studentError },
  ] = await Promise.all([
    supabase
      .from('clinic_enrollment')
      .select('*, clinic_slot(*)')
      .eq('teacher_id', teacherId)
      .lte('start_date', today)
      .or(`end_date.is.null,end_date.gt.${fromDate}`),
    supabase
      .from('clinic_attendance')
      .select('*')
      .eq('teacher_id', teacherId)
      .gte('date', fromDate)
      .lte('date', today),
    supabase
      .from('student')
      .select('id, name')
      .eq('teacher_id', teacherId),
  ])

  if (enrollmentError) return err(enrollmentError.message, 500)
  if (attendanceError) return err(attendanceError.message, 500)
  if (studentError) return err(studentError.message, 500)

  const studentNames = new Map((students ?? []).map((student: StudentRow) => [student.id, student.name]))
  const attendanceByStudentDate = new Map(
    ((attendance ?? []) as ClinicAttendance[]).map((record) => [`${record.student_id}:${record.date}`, record.status])
  )
  const summaryByStudent = new Map<string, {
    student_id: string
    student_name: string
    scheduled: number
    present: number
    absent: number
    missing: number
    last_absent_date: string | null
    last_missing_date: string | null
  }>()

  for (const enrollment of (enrollments ?? []) as unknown as ClinicEnrollmentRow[]) {
    const slot = one(enrollment.clinic_slot)
    if (!slot) continue
    const start = enrollment.start_date > fromDate ? enrollment.start_date : fromDate
    const end = enrollment.end_date && enrollment.end_date < addDays(today, 1) ? addDays(enrollment.end_date, -1) : today
    if (start > end) continue

    let summary = summaryByStudent.get(enrollment.student_id)
    if (!summary) {
      summary = {
        student_id: enrollment.student_id,
        student_name: studentNames.get(enrollment.student_id) ?? '이름 없음',
        scheduled: 0,
        present: 0,
        absent: 0,
        missing: 0,
        last_absent_date: null,
        last_missing_date: null,
      }
      summaryByStudent.set(enrollment.student_id, summary)
    }

    for (let date = start; date <= end; date = addDays(date, 1)) {
      if (weekdayFromDate(date) !== slot.weekday) continue
      summary.scheduled += 1
      const status = attendanceByStudentDate.get(`${enrollment.student_id}:${date}`)
      if (status === 'present') {
        summary.present += 1
      } else if (status === 'absent') {
        summary.absent += 1
        summary.last_absent_date = !summary.last_absent_date || date > summary.last_absent_date ? date : summary.last_absent_date
      } else {
        summary.missing += 1
        summary.last_missing_date = !summary.last_missing_date || date > summary.last_missing_date ? date : summary.last_missing_date
      }
    }
  }

  const studentsSummary = Array.from(summaryByStudent.values())
    .map((item) => ({
      ...item,
      attendance_rate: item.scheduled > 0 ? Math.round((item.present / item.scheduled) * 100) : null,
    }))
    .sort((a, b) => (a.attendance_rate ?? 101) - (b.attendance_rate ?? 101) || b.missing - a.missing || b.absent - a.absent || a.student_name.localeCompare(b.student_name, 'ko'))

  return ok({
    from_date: fromDate,
    to_date: today,
    students: studentsSummary,
    totals: {
      scheduled: studentsSummary.reduce((sum, item) => sum + item.scheduled, 0),
      present: studentsSummary.reduce((sum, item) => sum + item.present, 0),
      absent: studentsSummary.reduce((sum, item) => sum + item.absent, 0),
      missing: studentsSummary.reduce((sum, item) => sum + item.missing, 0),
    },
  })
}
