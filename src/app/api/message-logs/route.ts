import { getAuth, err, ok } from '@/lib/api'

// 전송 내역 목록 조회
export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { searchParams } = new URL(request.url)
  const studentId = searchParams.get('student_id')
  const limitParam = searchParams.get('limit')
  const offsetParam = searchParams.get('offset')

  let query = supabase
    .from('message_log')
    .select('*, student(id, name, mother_phone, father_phone, phone), week(id, week_number, class_id, class(id, name))', { count: 'exact' })
    .order('sent_at', { ascending: false })

  if (studentId) query = query.eq('student_id', studentId)

  if (limitParam) {
    const limit = parseInt(limitParam)
    const offset = parseInt(offsetParam ?? '0')
    query = query.range(offset, offset + limit - 1)
  }

  const { data, error, count } = await query
  if (error) return err(error.message, 500)

  if (limitParam) return ok({ logs: data, total: count ?? 0 })
  return ok(data)
}

// 전송 완료 저장
export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { student_id, week_id, message } = await request.json()
  if (!student_id || !message) {
    return err('필수 항목 누락')
  }

  const { data, error } = await supabase
    .from('message_log')
    .insert({ student_id, week_id: week_id ?? null, message })
    .select()
    .single()

  if (error) return err(error.message, 500)
  return ok(data)
}
