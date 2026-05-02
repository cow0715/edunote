import { getAuth, getTeacherId, assertClassOwner, err, ok } from '@/lib/api'
import { closeCurrentPeriods } from '@/lib/class-period-api'

const EXAM_TYPES = new Set(['midterm', 'final', 'other'])

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId } = await params
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertClassOwner(supabase, classId, teacherId)) return err('접근 권한 없음', 403)

  const { data, error } = await supabase
    .from('class_period')
    .select('*')
    .eq('class_id', classId)
    .order('sort_order')
    .order('start_date')

  if (error) return err(error.message, 500)
  return ok(data ?? [])
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId } = await params
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertClassOwner(supabase, classId, teacherId)) return err('접근 권한 없음', 403)

  const body = await request.json().catch(() => ({}))
  const label = String(body.label ?? '').trim()
  const semester = Number(body.semester)
  const examType = String(body.exam_type ?? 'other')
  const startDate = String(body.start_date ?? '').slice(0, 10)
  const endDate = body.end_date ? String(body.end_date).slice(0, 10) : null
  const isCurrent = body.is_current !== false

  if (!label) return err('기간 이름이 필요합니다', 400)
  if (semester !== 1 && semester !== 2) return err('학기는 1 또는 2만 가능합니다', 400)
  if (!EXAM_TYPES.has(examType)) return err('기간 유형이 올바르지 않습니다', 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return err('시작일이 필요합니다', 400)
  if (endDate && endDate < startDate) return err('종료일은 시작일 이후여야 합니다', 400)

  if (isCurrent) {
    const closeError = await closeCurrentPeriods(supabase, classId, startDate)
    if (closeError) return err(closeError.message ?? '湲곌컙 ?꾪솚 ?ㅽ뙣', 500)
  }

  const { data: latest } = await supabase
    .from('class_period')
    .select('sort_order')
    .eq('class_id', classId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const sortOrder = Number.isInteger(body.sort_order)
    ? Number(body.sort_order)
    : ((latest?.[0]?.sort_order ?? 0) + 1)

  const { data, error } = await supabase
    .from('class_period')
    .insert({
      class_id: classId,
      label,
      semester,
      exam_type: examType,
      start_date: startDate,
      end_date: endDate,
      is_current: isCurrent,
      sort_order: sortOrder,
    })
    .select()
    .single()

  if (error) return err(error.message, 500)
  return ok(data, { status: 201 })
}
