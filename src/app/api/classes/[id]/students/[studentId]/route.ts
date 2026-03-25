import { getAuth, err, ok } from '@/lib/api'

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; studentId: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId, studentId } = await params
  const { error } = await supabase.from('class_student').delete().eq('class_id', classId).eq('student_id', studentId)
  if (error) { console.error('[DELETE /api/classes/[id]/students/[studentId]]', error); return err(error.message, 500) }
  return ok({ ok: true })
}