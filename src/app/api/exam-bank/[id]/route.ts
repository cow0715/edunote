import { getAuth, getTeacherId, err, ok } from '@/lib/api'

// DELETE — 기출 시험 삭제 (cascade로 문항도 삭제)
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { id } = await params

  const { error } = await supabase
    .from('exam_bank')
    .delete()
    .eq('id', id)
    .eq('teacher_id', teacherId)

  if (error) return err(error.message)
  return ok({ ok: true })
}
