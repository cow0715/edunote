import { getAuth, getTeacherId, err, ok } from '@/lib/api'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id } = await params
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  const { data, error } = await supabase.from('class').select('*').eq('id', id).eq('teacher_id', teacherId).single()
  if (error) return err(error.message, 500)
  return ok(data)
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id } = await params
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  const { name, description, start_date, end_date, schedule_days } = await request.json()
  const { data, error } = await supabase.from('class').update({ name, description, start_date, end_date, ...(schedule_days !== undefined && { schedule_days }) }).eq('id', id).eq('teacher_id', teacherId).select().single()
  if (error) return err(error.message, 500)
  return ok(data)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id } = await params
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  const { error } = await supabase.from('class').delete().eq('id', id).eq('teacher_id', teacherId)
  if (error) return err(error.message, 500)
  return ok({ ok: true })
}