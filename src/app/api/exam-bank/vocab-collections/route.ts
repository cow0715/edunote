import { getAuth, getTeacherId, err, ok } from '@/lib/api'

export async function GET() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { data, error } = await supabase
    .from('vocab_collection')
    .select('id, title, grade, year_from, year_to, months, item_count, created_at')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })

  if (error) return err(error.message, 500)
  return ok(data ?? [])
}
