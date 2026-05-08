import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import type { ClinicEnrollment, ClinicWeekday } from '@/lib/types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_KEYS: ClinicWeekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function weekdayFromDate(date: string): ClinicWeekday | null {
  if (!DATE_RE.test(date)) return null
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return DAY_KEYS[d.getDay()]
}

export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const date = new URL(request.url).searchParams.get('date') ?? ''
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

  let enrollments: ClinicEnrollment[] = []
  if (slot) {
    const { data, error: enrollmentError } = await supabase
      .from('clinic_enrollment')
      .select('*')
      .eq('teacher_id', teacherId)
      .eq('clinic_slot_id', slot.id)
      .lte('start_date', date)
      .or(`end_date.is.null,end_date.gt.${date}`)

    if (enrollmentError) return err(enrollmentError.message, 500)
    enrollments = data ?? []
  }

  const { data: attendance, error } = await supabase
    .from('clinic_attendance')
    .select('*')
    .eq('teacher_id', teacherId)
    .eq('date', date)

  if (error) return err(error.message, 500)
  return ok({ slot: slot ?? null, attendance: attendance ?? [], enrollments })
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const body = await request.json().catch(() => ({})) as {
    date?: string
    clinic_slot_id?: string
    records?: { student_id?: string; status?: 'present' | 'absent' }[]
  }
  const weekday = weekdayFromDate(body.date ?? '')
  if (!body.date || !weekday) return err('날짜 형식이 올바르지 않습니다')
  if (!body.clinic_slot_id) return err('보충수업 요일이 필요합니다')
  if (!Array.isArray(body.records)) return err('출석 기록이 필요합니다')

  const { data: slot, error: slotError } = await supabase
    .from('clinic_slot')
    .select('id, weekday')
    .eq('id', body.clinic_slot_id)
    .eq('teacher_id', teacherId)
    .eq('is_active', true)
    .single()

  if (slotError || !slot) return err('활성 보충수업 요일을 찾을 수 없습니다', 422)
  if (slot.weekday !== weekday) return err('선택한 날짜와 보충수업 요일이 맞지 않습니다', 422)

  const { data: enrollments, error: enrollmentError } = await supabase
    .from('clinic_enrollment')
    .select('student_id')
    .eq('teacher_id', teacherId)
    .eq('clinic_slot_id', body.clinic_slot_id)
    .lte('start_date', body.date)
    .or(`end_date.is.null,end_date.gt.${body.date}`)

  if (enrollmentError) return err(enrollmentError.message, 500)
  const allowedIds = new Set((enrollments ?? []).map((item) => item.student_id))

  const rows = body.records.map((record) => {
    if (!record.student_id || !allowedIds.has(record.student_id)) {
      throw new Error('출석 대상이 아닌 학생이 포함되어 있습니다')
    }
    if (record.status !== 'present' && record.status !== 'absent') {
      throw new Error('출석 상태가 올바르지 않습니다')
    }
    return {
      teacher_id: teacherId,
      student_id: record.student_id,
      clinic_slot_id: body.clinic_slot_id,
      date: body.date,
      status: record.status,
    }
  })

  try {
    if (rows.length > 0) {
      const { error } = await supabase
        .from('clinic_attendance')
        .upsert(rows, { onConflict: 'teacher_id,student_id,date' })
      if (error) return err(error.message, 500)
    }
    return ok({ ok: true, saved: rows.length })
  } catch (e) {
    return err(e instanceof Error ? e.message : '출석 저장 실패')
  }
}
