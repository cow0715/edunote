import type { SupabaseServerClient } from '@/lib/api'

function dateOnly(value: string) {
  return value.slice(0, 10)
}

export async function getActiveClassIdsForTeacher(supabase: SupabaseServerClient, teacherId: string) {
  const { data, error } = await supabase
    .from('class')
    .select('id')
    .eq('teacher_id', teacherId)
    .is('archived_at', null)

  if (error) throw error
  return (data ?? []).map((cls) => cls.id)
}

export async function hasActiveClassEnrollment(
  supabase: SupabaseServerClient,
  teacherId: string,
  studentId: string,
) {
  const classIds = await getActiveClassIdsForTeacher(supabase, teacherId)
  if (classIds.length === 0) return false

  const { data, error } = await supabase
    .from('class_student')
    .select('id')
    .eq('student_id', studentId)
    .in('class_id', classIds)
    .is('left_at', null)
    .limit(1)

  if (error) throw error
  return (data?.length ?? 0) > 0
}

export async function closeClinicEnrollmentsForStudent(
  supabase: SupabaseServerClient,
  teacherId: string,
  studentId: string,
  leftAt: string,
) {
  const endDate = dateOnly(leftAt)
  const { data, error } = await supabase
    .from('clinic_enrollment')
    .select('id, start_date')
    .eq('teacher_id', teacherId)
    .eq('student_id', studentId)
    .or(`end_date.is.null,end_date.gt.${endDate}`)

  if (error) throw error

  for (const enrollment of data ?? []) {
    const effectiveEndDate = enrollment.start_date > endDate ? enrollment.start_date : endDate
    const { error: updateError } = await supabase
      .from('clinic_enrollment')
      .update({ end_date: effectiveEndDate })
      .eq('id', enrollment.id)

    if (updateError) throw updateError
  }
}

export async function closeClinicEnrollmentsIfNoActiveClass(
  supabase: SupabaseServerClient,
  teacherId: string,
  studentId: string,
  leftAt: string,
) {
  if (await hasActiveClassEnrollment(supabase, teacherId, studentId)) return
  await closeClinicEnrollmentsForStudent(supabase, teacherId, studentId, leftAt)
}
