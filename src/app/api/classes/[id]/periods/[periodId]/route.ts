import { getAuth, getTeacherId, assertClassOwner, err, ok } from '@/lib/api'
import { closeCurrentPeriods } from '@/lib/class-period-api'

const EXAM_TYPES = new Set(['midterm', 'final', 'other'])

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; periodId: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId, periodId } = await params
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertClassOwner(supabase, classId, teacherId)) return err('접근 권한 없음', 403)

  const { data: current } = await supabase
    .from('class_period')
    .select('id, class_id, start_date')
    .eq('id', periodId)
    .eq('class_id', classId)
    .single()
  if (!current) return err('기간을 찾을 수 없습니다', 404)

  const body = await request.json().catch(() => ({}))
  const patch: Record<string, unknown> = {}

  if ('label' in body) {
    const label = String(body.label ?? '').trim()
    if (!label) return err('기간 이름이 필요합니다', 400)
    patch.label = label
  }
  if ('semester' in body) {
    const semester = Number(body.semester)
    if (semester !== 1 && semester !== 2) return err('학기는 1 또는 2만 가능합니다', 400)
    patch.semester = semester
  }
  if ('exam_type' in body) {
    const examType = String(body.exam_type)
    if (!EXAM_TYPES.has(examType)) return err('기간 유형이 올바르지 않습니다', 400)
    patch.exam_type = examType
  }
  if ('start_date' in body) {
    const startDate = String(body.start_date ?? '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return err('시작일이 필요합니다', 400)
    patch.start_date = startDate
  }
  if ('end_date' in body) {
    patch.end_date = body.end_date ? String(body.end_date).slice(0, 10) : null
  }
  if ('sort_order' in body) patch.sort_order = Number(body.sort_order) || 0

  const nextStartDate = String(patch.start_date ?? current.start_date)
  const nextEndDate = patch.end_date === undefined
    ? undefined
    : patch.end_date === null
      ? null
      : String(patch.end_date)
  if (nextEndDate && nextEndDate < nextStartDate) return err('종료일은 시작일 이후여야 합니다', 400)

  if (body.is_current === true) {
    const closeError = await closeCurrentPeriods(supabase, classId, nextStartDate, periodId)
    if (closeError) return err(closeError.message ?? '湲곌컙 ?꾪솚 ?ㅽ뙣', 500)
    patch.is_current = true
  } else if (body.is_current === false) {
    patch.is_current = false
  }

  const { data, error } = await supabase
    .from('class_period')
    .update(patch)
    .eq('id', periodId)
    .eq('class_id', classId)
    .select()
    .single()

  if (error) return err(error.message, 500)
  return ok(data)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; periodId: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId, periodId } = await params
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertClassOwner(supabase, classId, teacherId)) return err('접근 권한 없음', 403)

  const { error } = await supabase
    .from('class_period')
    .delete()
    .eq('id', periodId)
    .eq('class_id', classId)

  if (error) return err(error.message, 500)
  return ok({ ok: true })
}
