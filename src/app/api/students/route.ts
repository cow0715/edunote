import { getAuth, getTeacherId, err, ok } from '@/lib/api'

export async function GET() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { data, error } = await supabase
    .from('student')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('name')

  if (error) {
    console.error('[GET /api/students]', error)
    return err(error.message, 500)
  }

  return ok(data)
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { name, phone, father_phone, mother_phone, school, grade, memo } = await request.json()

  const { data, error } = await supabase
    .from('student')
    .insert({ teacher_id: teacherId, name, phone, father_phone, mother_phone, school, grade, memo })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/students]', error)
    return err(error.message, 500)
  }

  return ok(data, { status: 201 })
}
