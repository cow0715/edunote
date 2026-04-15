import { getAuth, getTeacherId, err, ok } from '@/lib/api'

// GET /api/report-cards?studentId=xxx  — 학생별 성적표 목록
export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { searchParams } = new URL(request.url)
  const studentId = searchParams.get('studentId')
  if (!studentId) return err('studentId 필요', 400)

  const { data, error } = await supabase
    .from('report_card')
    .select('*')
    .eq('teacher_id', teacherId)
    .eq('student_id', studentId)
    .order('period_start', { ascending: false })

  if (error) return err(error.message, 500)
  return ok(data)
}

// POST /api/report-cards  — 신규 성적표 생성 (draft)
export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const body = await request.json() as {
    student_id: string
    period_type: 'monthly' | 'quarterly' | 'semester'
    period_start: string
    period_end: string
    period_label: string
  }

  const { data, error } = await supabase
    .from('report_card')
    .insert({
      teacher_id: teacherId,
      student_id: body.student_id,
      period_type: body.period_type,
      period_start: body.period_start,
      period_end: body.period_end,
      period_label: body.period_label,
      highlighted_wrong_ids: [],
      status: 'draft',
    })
    .select()
    .single()

  if (error) return err(error.message, 500)
  return ok(data, { status: 201 })
}
