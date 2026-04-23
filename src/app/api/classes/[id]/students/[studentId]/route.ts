import { getAuth, getTeacherId, assertClassOwner, err, ok } from '@/lib/api'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; studentId: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId, studentId } = await params
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertClassOwner(supabase, classId, teacherId)) return err('접근 권한 없음', 403)
  const { joined_at } = await request.json()
  const { error } = await supabase
    .from('class_student')
    .update({ joined_at })
    .eq('class_id', classId)
    .eq('student_id', studentId)
  if (error) { console.error('[PATCH /api/classes/[id]/students/[studentId]]', error); return err(error.message, 500) }
  return ok({ ok: true })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; studentId: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId, studentId } = await params
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertClassOwner(supabase, classId, teacherId)) return err('접근 권한 없음', 403)
  const body = await request.json().catch(() => ({}))
  const left_at = body?.left_at ?? new Date().toISOString()
  const { error } = await supabase
    .from('class_student')
    .update({ left_at })
    .eq('class_id', classId)
    .eq('student_id', studentId)
  if (error) { console.error('[DELETE /api/classes/[id]/students/[studentId]]', error); return err(error.message, 500) }
  return ok({ ok: true })
}