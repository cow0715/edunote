import { getAuth, getTeacherId, err, ok } from '@/lib/api'

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; memoId: string }> }) {
  const { supabase, user } = await getAuth()
  const { memoId } = await params
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { error } = await supabase
    .from('teacher_memos')
    .delete()
    .eq('id', memoId)
    .eq('teacher_id', teacherId)

  if (error) return err(error.message, 500)
  return ok({ ok: true })
}
