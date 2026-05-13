import { getAuth, getTeacherId, err, ok } from '@/lib/api'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isDateString(value: string) {
  if (!DATE_RE.test(value)) return false
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return false
  const normalized = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return normalized === value
}

async function assertActiveStudent(
  supabase: Awaited<ReturnType<typeof getAuth>>['supabase'],
  teacherId: string,
  studentId: string,
) {
  const { data: classes } = await supabase
    .from('class')
    .select('id')
    .eq('teacher_id', teacherId)
    .is('archived_at', null)

  const classIds = (classes ?? []).map((cls) => cls.id)
  if (classIds.length === 0) return false

  const { data } = await supabase
    .from('class_student')
    .select('id')
    .eq('student_id', studentId)
    .in('class_id', classIds)
    .is('left_at', null)
    .limit(1)

  return (data?.length ?? 0) > 0
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const body = await request.json().catch(() => ({})) as {
    student_id?: string
    clinic_slot_id?: string | null
    start_date?: string
    action?: 'enroll' | 'unenroll'
  }
  if (!body.student_id) return err('학생이 필요합니다')
  const today = todayStr()
  const startDate = body.start_date || today
  if (!isDateString(startDate)) return err('적용 시작일 형식이 올바르지 않습니다')

  if (!await assertActiveStudent(supabase, teacherId, body.student_id)) {
    return err('재원 학생만 보충수업에 배정할 수 있습니다', 422)
  }

  const requestedSlotId = body.clinic_slot_id ?? null
  const action = body.action ?? (requestedSlotId ? 'enroll' : 'unenroll')
  if (action !== 'enroll' && action !== 'unenroll') return err('배정 동작이 올바르지 않습니다')

  if (requestedSlotId) {
    const { data: slot, error: slotError } = await supabase
      .from('clinic_slot')
      .select('id')
      .eq('id', requestedSlotId)
      .eq('teacher_id', teacherId)
      .eq('is_active', true)
      .single()

    if (slotError || !slot) return err('활성 보충수업 요일을 찾을 수 없습니다', 422)
  }

  if (action === 'unenroll') {
    let query = supabase
      .from('clinic_enrollment')
      .select('id, start_date')
      .eq('teacher_id', teacherId)
      .eq('student_id', body.student_id)
      .or(`end_date.is.null,end_date.gt.${startDate}`)

    if (requestedSlotId) {
      query = query.eq('clinic_slot_id', requestedSlotId)
    }

    const { data: enrollments, error: enrollmentError } = await query
    if (enrollmentError) return err(enrollmentError.message, 500)

    for (const enrollment of enrollments ?? []) {
      const endDate = enrollment.start_date > startDate ? enrollment.start_date : startDate
      const { error: closeError } = await supabase
        .from('clinic_enrollment')
        .update({ end_date: endDate })
        .eq('id', enrollment.id)

      if (closeError) return err(closeError.message, 500)
    }

    return ok({ ok: true, enrollment: null })
  }

  if (!requestedSlotId) return err('배정할 보충수업 요일이 필요합니다')

  const { data: existingOverlaps, error: existingOverlapError } = await supabase
    .from('clinic_enrollment')
    .select('*, clinic_slot(*)')
    .eq('teacher_id', teacherId)
    .eq('student_id', body.student_id)
    .eq('clinic_slot_id', requestedSlotId)
    .or(`end_date.is.null,end_date.gt.${startDate}`)
    .order('start_date', { ascending: false })

  if (existingOverlapError) return err(existingOverlapError.message, 500)

  const existingOpen = (existingOverlaps ?? []).find((enrollment) => !enrollment.end_date)
  if (existingOpen) {
    if (existingOpen.start_date > startDate) {
      const { data, error } = await supabase
        .from('clinic_enrollment')
        .update({ start_date: startDate })
        .eq('id', existingOpen.id)
        .select('*, clinic_slot(*)')
        .single()

      if (error) return err(error.message, 500)
      return ok({ ok: true, enrollment: data })
    }

    return ok({ ok: true, enrollment: existingOpen })
  }

  const existingEndingLater = (existingOverlaps ?? [])[0]
  if (existingEndingLater) {
    const { data, error } = await supabase
      .from('clinic_enrollment')
      .update({ end_date: null })
      .eq('id', existingEndingLater.id)
      .select('*, clinic_slot(*)')
      .single()

    if (error) return err(error.message, 500)
    return ok({ ok: true, enrollment: data })
  }

  const { data, error } = await supabase
    .from('clinic_enrollment')
    .insert({
      teacher_id: teacherId,
      student_id: body.student_id,
      clinic_slot_id: requestedSlotId,
      start_date: startDate,
      end_date: null,
    })
    .select('*, clinic_slot(*)')
    .single()

  if (error) return err(error.message, 500)
  return ok({ ok: true, enrollment: data })
}
