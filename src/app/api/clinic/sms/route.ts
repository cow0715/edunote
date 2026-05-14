import { err, getAuth, getTeacherId, ok } from '@/lib/api'
import type { ClinicEnrollment, ClinicSlot } from '@/lib/types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

type StudentRow = {
  id: string
  name: string
  phone: string | null
  father_phone: string | null
  mother_phone: string | null
}

type EnrollmentRow = ClinicEnrollment & {
  student: StudentRow | StudentRow[] | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function weekdayFromDate(date: string) {
  if (!DATE_RE.test(date)) return null
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return DAY_KEYS[d.getDay()]
}

function formatTime(value: string) {
  return value.slice(0, 5)
}

export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const date = new URL(request.url).searchParams.get('date') ?? todayStr()
  const weekday = weekdayFromDate(date)
  if (!weekday) return err('날짜 형식이 올바르지 않습니다')

  const { data: slot, error: slotError } = await supabase
    .from('clinic_slot')
    .select('*')
    .eq('teacher_id', teacherId)
    .eq('weekday', weekday)
    .eq('is_active', true)
    .maybeSingle()

  if (slotError) return err(slotError.message, 500)
  if (!slot) {
    return ok({
      date,
      slot: null,
      slot_label: null,
      messages: [],
    })
  }

  const { data, error } = await supabase
    .from('clinic_enrollment')
    .select('*, student(id, name, phone, father_phone, mother_phone)')
    .eq('teacher_id', teacherId)
    .eq('clinic_slot_id', slot.id)
    .lte('start_date', date)
    .or(`end_date.is.null,end_date.gt.${date}`)

  if (error) return err(error.message, 500)

  const messages = ((data ?? []) as EnrollmentRow[])
    .filter((enrollment) => enrollment.end_date !== enrollment.start_date)
    .flatMap((enrollment) => {
      const student = one(enrollment.student)
      if (!student) return []
      return [{
        student_id: student.id,
        student_name: student.name,
        phone: student.phone,
        father_phone: student.father_phone,
        mother_phone: student.mother_phone,
        message: '',
      }]
    })
    .sort((a, b) => a.student_name.localeCompare(b.student_name, 'ko'))

  const clinicSlot = slot as ClinicSlot

  return ok({
    date,
    slot: clinicSlot,
    slot_label: `${formatTime(clinicSlot.starts_at)}-${formatTime(clinicSlot.ends_at)}`,
    messages,
  })
}
