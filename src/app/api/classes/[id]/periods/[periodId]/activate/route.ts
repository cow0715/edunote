import { getAuth, getTeacherId, assertClassOwner, err, ok } from '@/lib/api'
import { closeCurrentPeriods } from '@/lib/class-period-api'

export async function POST(_: Request, { params }: { params: Promise<{ id: string; periodId: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId, periodId } = await params
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertClassOwner(supabase, classId, teacherId)) return err('접근 권한 없음', 403)

  const { data: period } = await supabase
    .from('class_period')
    .select('id, start_date')
    .eq('id', periodId)
    .eq('class_id', classId)
    .single()

  if (!period) return err('기간을 찾을 수 없습니다', 404)

  const closeError = await closeCurrentPeriods(supabase, classId, period.start_date, periodId)
  if (closeError) return err(closeError.message ?? '기간 전환 실패', 500)

  const { data, error } = await supabase
    .from('class_period')
    .update({ is_current: true, end_date: null })
    .eq('id', periodId)
    .eq('class_id', classId)
    .select()
    .single()

  if (error) return err(error.message, 500)
  return ok(data)
}
