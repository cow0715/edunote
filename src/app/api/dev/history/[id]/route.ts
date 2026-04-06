import { err, ok, getAuth, getTeacherId } from '@/lib/api'

// PATCH — 메모 수정
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { id } = await params
  const { note } = await request.json()

  const { error } = await supabase
    .from('dev_compare_history')
    .update({ note })
    .eq('id', id)
    .eq('teacher_id', teacherId)

  if (error) return err(error.message)
  return ok({ ok: true })
}

// DELETE — 단건 삭제
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { id } = await params

  const { error } = await supabase
    .from('dev_compare_history')
    .delete()
    .eq('id', id)
    .eq('teacher_id', teacherId)

  if (error) return err(error.message)
  return ok({ ok: true })
}
