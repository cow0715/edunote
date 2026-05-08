import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { closeClinicEnrollmentsIfNoActiveClass, getActiveClassIdsForTeacher } from '@/lib/clinic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  const { id: studentId } = await params
  const { left_at } = await request.json()
  if (!left_at) return err('퇴원일 필요', 400)

  const classIds = await getActiveClassIdsForTeacher(supabase, teacherId)
  if (classIds.length === 0) return ok({ ok: true })

  const { error } = await supabase
    .from('class_student')
    .update({ left_at })
    .eq('student_id', studentId)
    .in('class_id', classIds)
    .is('left_at', null)

  if (error) { console.error('[POST /api/students/[id]/withdraw]', error); return err(error.message, 500) }
  try {
    await closeClinicEnrollmentsIfNoActiveClass(supabase, teacherId, studentId, left_at)
  } catch (clinicError) {
    const message = clinicError instanceof Error ? clinicError.message : '보충수업 배정 종료 실패'
    console.error('[POST /api/students/[id]/withdraw clinic]', clinicError)
    return err(message, 500)
  }
  return ok({ ok: true })
}
