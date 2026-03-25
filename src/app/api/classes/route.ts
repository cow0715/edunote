import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { generateSessionDates } from '@/lib/schedule'

export async function GET() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { data, error } = await supabase
    .from('class')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/classes] class 조회 실패:', error)
    return err(error.message, 500)
  }

  return ok(data)
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const body = await request.json()
  const { name, description, start_date, end_date, schedule_days = [] } = body

  const { data, error } = await supabase
    .from('class')
    .insert({ teacher_id: teacherId, name, description, start_date, end_date, schedule_days })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/classes] class 생성 실패:', error)
    return err(error.message, 500)
  }

  if (schedule_days.length > 0 && start_date && end_date) {
    const dates = generateSessionDates(start_date, end_date, schedule_days)
    if (dates.length > 0) {
      const weekRows = dates.map((date: string, i: number) => ({
        class_id: data.id,
        week_number: i + 1,
        start_date: date,
        vocab_total: 0,
        homework_total: 0,
      }))
      await supabase.from('week').insert(weekRows)
    }
  }

  return ok(data, { status: 201 })
}
