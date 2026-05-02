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
  const { name, description, start_date, end_date, schedule_days, academic_year, school_name, grade_level } = await request.json()
  const { data, error } = await supabase.from('class').update({
    name,
    description,
    start_date,
    end_date,
    academic_year: academic_year ? Number(academic_year) : null,
    school_name: school_name || null,
    grade_level: grade_level ? Number(grade_level) : null,
    ...(schedule_days !== undefined && { schedule_days }),
  }).eq('id', id).eq('teacher_id', teacherId).select().single()
  if (error) return err(error.message, 500)
  return ok(data)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id } = await params
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const body = await request.json().catch(() => ({}))
  const patch: Record<string, unknown> = {}
  if ('archived_at' in body) patch.archived_at = body.archived_at
  if ('academic_year' in body) patch.academic_year = body.academic_year ? Number(body.academic_year) : null
  if ('school_name' in body) patch.school_name = body.school_name || null
  if ('grade_level' in body) patch.grade_level = body.grade_level ? Number(body.grade_level) : null

  const { data, error } = await supabase
    .from('class')
    .update(patch)
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .select()
    .single()

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
