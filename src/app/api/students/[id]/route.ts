import { getAuth, getTeacherId, err, ok } from '@/lib/api'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id } = await params
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { name, phone, father_phone, mother_phone, school, grade, memo } = await request.json()

  const { data, error } = await supabase
    .from('student')
    .update({ name, phone, father_phone, mother_phone, school, grade, memo })
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .select()
    .single()

  if (error) {
    console.error('[PUT /api/students]', error)
    return err(error.message, 500)
  }

  return ok(data)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id } = await params
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { error } = await supabase
    .from('student')
    .delete()
    .eq('id', id)
    .eq('teacher_id', teacherId)

  if (error) {
    console.error('[DELETE /api/students]', error)
    return err(error.message, 500)
  }

  return ok({ ok: true })
}
