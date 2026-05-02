import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { buildWeekDisplayMap, type ClassPeriod } from '@/lib/class-periods'

// GET — 오늘 날짜(KST)에 start_date가 해당하는 주차 목록
// 반 정보(name)와 함께 반환
export async function GET() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  // KST 오늘 날짜 (UTC+9)
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const today = kst.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('week')
    .select('id, week_number, start_date, class_id, class!inner(id, name, teacher_id)')
    .eq('start_date', today)
    .eq('class.teacher_id', teacherId)
    .order('week_number')

  if (error) return err(error.message)
  const weeks = data ?? []
  const classIds = [...new Set(weeks.map((w) => w.class_id))]
  const { data: periods } = classIds.length > 0
    ? await supabase.from('class_period').select('*').in('class_id', classIds).order('sort_order').order('start_date')
    : { data: [] }
  const displayMap = buildWeekDisplayMap(
    weeks.map((w) => ({ id: w.id, class_id: w.class_id, week_number: w.week_number, start_date: w.start_date })),
    (periods ?? []) as ClassPeriod[],
  )
  return ok(weeks.map((w) => ({ ...w, display_label: displayMap.get(w.id)?.displayLabel ?? `${w.week_number}주차` })))
}
