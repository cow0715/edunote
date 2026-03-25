import { getAuth, getTeacherId, err, ok } from '@/lib/api'

export async function GET() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 없음', 404)

  const { data, error } = await supabase
    .from('concept_category')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('sort_order')

  if (error) return err(error.message, 500)
  return ok(data)
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 없음', 404)

  const { name, sort_order } = await request.json()
  const { data, error } = await supabase
    .from('concept_category')
    .insert({ teacher_id: teacherId, name, sort_order })
    .select()
    .single()

  if (error) return err(error.message, 500)
  return ok(data)
}
