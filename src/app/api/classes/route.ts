import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { generateSessionDates } from '@/lib/schedule'

export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const includeArchived = new URL(request.url).searchParams.get('includeArchived') === '1'
  let query = supabase
    .from('class')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })
  if (!includeArchived) query = query.is('archived_at', null)

  const { data, error } = await query

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
  const {
    name,
    description,
    start_date,
    end_date,
    schedule_days = [],
    academic_year,
    school_name,
    grade_level,
    period_label = '1학기 중간',
  } = body

  const { data, error } = await supabase
    .from('class')
    .insert({
      teacher_id: teacherId,
      name,
      description,
      start_date,
      end_date,
      schedule_days,
      academic_year: academic_year ? Number(academic_year) : null,
      school_name: school_name || null,
      grade_level: grade_level ? Number(grade_level) : null,
    })
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

  const { error: periodError } = await supabase.from('class_period').insert({
    class_id: data.id,
    label: period_label,
    semester: 1,
    exam_type: 'midterm',
    start_date: start_date || new Date().toISOString().slice(0, 10),
    end_date: null,
    is_current: true,
    sort_order: 1,
  })
  if (periodError) {
    console.error('[POST /api/classes] class_period 생성 실패:', periodError)
    return err(periodError.message, 500)
  }

  return ok(data, { status: 201 })
}
