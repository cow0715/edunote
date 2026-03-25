import { getAuth, getTeacherId, err, ok } from '@/lib/api'

export async function GET() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 없음', 404)

  const { data, error } = await supabase
    .from('concept_tag')
    .select('*, concept_category(*)')
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

  const { name, concept_category_id, sort_order } = await request.json()
  const { data, error } = await supabase
    .from('concept_tag')
    .insert({ teacher_id: teacherId, name, concept_category_id: concept_category_id || null, sort_order })
    .select('*, concept_category(*)')
    .single()

  if (error) return err(error.message, 500)
  return ok(data)
}
