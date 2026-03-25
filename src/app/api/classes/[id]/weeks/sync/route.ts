import { getAuth, err, ok } from '@/lib/api'
import { generateSessionDates } from '@/lib/schedule'

// POST /api/classes/[id]/weeks/sync
// 스케줄 기반으로 주차 재생성 (데이터 있는 주차 삭제 여부는 force 파라미터로 제어)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: classId } = await params
  if (!user) return err('인증 필요', 401)

  const { force = false } = await request.json().catch(() => ({ force: false }))

  const { data: cls } = await supabase
    .from('class')
    .select('start_date, end_date, schedule_days')
    .eq('id', classId)
    .single()

  if (!cls) return err('수업 없음', 404)

  const scheduleDays: string[] = cls.schedule_days ?? []
  if (!scheduleDays.length) return err('요일 설정 없음')

  const newDates = generateSessionDates(cls.start_date, cls.end_date, scheduleDays)

  // 기존 주차 조회
  const { data: existingWeeks } = await supabase
    .from('week')
    .select('id, week_number, start_date')
    .eq('class_id', classId)
    .order('week_number')

  const existing = existingWeeks ?? []
  const newDateSet = new Set(newDates)
  const existingDateSet = new Set(existing.map((w) => w.start_date).filter(Boolean))

  // 삭제 대상: start_date 없거나 새 스케줄에 없는 주차 (수동 추가 포함)
  const toDelete = existing.filter((w) => !w.start_date || !newDateSet.has(w.start_date))
  const toDeleteIds = toDelete.map((w) => w.id)

  // 삭제 대상 중 채점 데이터가 있는 주차 확인
  let hasData = false
  if (toDeleteIds.length > 0) {
    const { count } = await supabase
      .from('week_score')
      .select('id', { count: 'exact', head: true })
      .in('week_id', toDeleteIds)
    hasData = (count ?? 0) > 0
  }

  if (hasData && !force) {
    return ok({
      warning: true,
      message: '삭제될 주차에 채점 데이터가 있습니다. 계속하면 해당 데이터가 삭제됩니다.',
      affected_weeks: toDelete.map((w) => w.week_number),
    })
  }

  // 삭제 실행
  if (toDeleteIds.length > 0) {
    await supabase.from('week').delete().in('id', toDeleteIds)
  }

  // 추가 대상: 새 스케줄 날짜 중 기존에 없는 것
  const toInsertDates = newDates.filter((d) => !existingDateSet.has(d))

  // 기존 + 추가될 날짜를 정렬하여 week_number 재계산
  const survivingDates = existing
    .filter((w) => w.start_date && newDateSet.has(w.start_date))
    .map((w) => w.start_date as string)

  const allDates = [...new Set([...survivingDates, ...toInsertDates])].sort()

  // 기존 주차 week_number 업데이트
  const existingByDate = new Map(existing.map((w) => [w.start_date, w]))
  for (let i = 0; i < allDates.length; i++) {
    const date = allDates[i]
    const ex = existingByDate.get(date)
    if (ex && ex.week_number !== i + 1) {
      await supabase.from('week').update({ week_number: i + 1 }).eq('id', ex.id)
    }
  }

  // 새 주차 삽입
  if (toInsertDates.length > 0) {
    const insertRows = toInsertDates.map((date) => {
      const weekNum = allDates.indexOf(date) + 1
      return {
        class_id: classId,
        week_number: weekNum,
        start_date: date,
        vocab_total: 0,
        homework_total: 0,
      }
    })
    await supabase.from('week').insert(insertRows)
  }

  return ok({ ok: true, total: allDates.length })
}
