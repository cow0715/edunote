import { getAuth, getTeacherId, err, ok } from '@/lib/api'

export async function GET() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { data, error } = await supabase
    .from('teacher')
    .select('id, name, email, academy_name, academy_english_name, academy_address, academy_phone, director_name')
    .eq('id', teacherId)
    .single()

  if (error) return err(error.message, 500)
  return ok(data)
}

export async function PATCH(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const body = await request.json() as {
    name?: string
    academy_name?: string | null
    academy_english_name?: string | null
    academy_address?: string | null
    academy_phone?: string | null
    director_name?: string | null
  }

  const patch: Record<string, unknown> = {}
  if ('name' in body) patch.name = body.name
  if ('academy_name' in body) patch.academy_name = body.academy_name
  if ('academy_english_name' in body) patch.academy_english_name = body.academy_english_name
  if ('academy_address' in body) patch.academy_address = body.academy_address
  if ('academy_phone' in body) patch.academy_phone = body.academy_phone
  if ('director_name' in body) patch.director_name = body.director_name

  const { data, error } = await supabase
    .from('teacher')
    .update(patch)
    .eq('id', teacherId)
    .select()
    .single()

  if (error) return err(error.message, 500)
  return ok(data)
}
