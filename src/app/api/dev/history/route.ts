import { err, ok, getAuth, getTeacherId } from '@/lib/api'

// GET — 히스토리 목록
export async function GET() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { data, error } = await supabase
    .from('dev_compare_history')
    .select('id, created_at, fn_id, fn_label, file_name, results, note')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return err(error.message)
  return ok(data)
}

// POST — 히스토리 저장
export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { fn_id, fn_label, file_name, results } = await request.json()
  if (!fn_id || !results) return err('필수 값 누락')

  const { data, error } = await supabase
    .from('dev_compare_history')
    .insert({ teacher_id: teacherId, fn_id, fn_label, file_name, results, note: '' })
    .select('id')
    .single()

  if (error) return err(error.message)
  return ok(data, { status: 201 })
}

// DELETE — 전체 삭제
export async function DELETE() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { error } = await supabase
    .from('dev_compare_history')
    .delete()
    .eq('teacher_id', teacherId)

  if (error) return err(error.message)
  return ok({ ok: true })
}
