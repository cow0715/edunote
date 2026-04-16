import { getAuth, err, ok } from '@/lib/api'
import { generateSessionDates } from '@/lib/schedule'

// POST /api/classes/[id]/weeks/sync
// 스케줄 기반 추가만 수행 (삭제 없음).
// - 빈 상태면 start_date~end_date 전체 주차를 생성
// - 기존 주차가 있으면 스케줄에 해당하는 날짜 중 누락된 것만 채움
// - 수동으로 옮긴 주차(스케줄 요일과 다른 날짜)는 건드리지 않음
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: classId } = await params
  if (!user) return err('인증 필요', 401)

  const { data: cls } = await supabase
    .from('class')
    .select('start_date, end_date, schedule_days')
    .eq('id', classId)
    .single()

  if (!cls) return err('수업 없음', 404)

  const scheduleDays: string[] = cls.schedule_days ?? []
  if (!scheduleDays.length) return err('요일 설정 없음')

  const scheduleDates = generateSessionDates(cls.start_date, cls.end_date, scheduleDays)

  // 기존 주차 조회
  const { data: existingWeeks } = await supabase
    .from('week')
    .select('id, week_number, start_date')
    .eq('class_id', classId)

  const existing = existingWeeks ?? []
  const existingDateSet = new Set(
    existing.map((w) => w.start_date).filter((d): d is string => !!d),
  )

  // 누락된 스케줄 날짜만 추가
  const toInsertDates = scheduleDates.filter((d) => !existingDateSet.has(d))

  if (toInsertDates.length === 0 && existing.length > 0) {
    return ok({ ok: true, total: existing.length, added: 0 })
  }

  // 기존 주차 + 새 날짜를 모두 날짜순으로 정렬하여 week_number 계산
  const allEntries: Array<{ id?: string; date: string; currentNumber?: number }> = [
    ...existing
      .filter((w) => !!w.start_date)
      .map((w) => ({ id: w.id, date: w.start_date as string, currentNumber: w.week_number })),
    ...toInsertDates.map((date) => ({ date })),
  ].sort((a, b) => a.date.localeCompare(b.date))

  // 삽입: 새 주차
  const insertRows = toInsertDates.map((date) => {
    const weekNum = allEntries.findIndex((e) => !e.id && e.date === date) + 1
    return {
      class_id: classId,
      week_number: weekNum,
      start_date: date,
      vocab_total: 0,
      homework_total: 0,
    }
  })

  // week_number 충돌 방지를 위해 기존 주차를 먼저 임시 음수로 미뤄둠
  for (let i = 0; i < existing.length; i++) {
    const w = existing[i]
    const target = allEntries.findIndex((e) => e.id === w.id) + 1
    if (target > 0 && w.week_number !== target) {
      const { error } = await supabase
        .from('week')
        .update({ week_number: -(10000 + i) })
        .eq('id', w.id)
      if (error) return err(error.message, 500)
    }
  }

  // 새 주차 삽입 (임시 충돌 없는 번호 확보 후)
  if (insertRows.length > 0) {
    const { error } = await supabase.from('week').insert(insertRows)
    if (error) return err(error.message, 500)
  }

  // 기존 주차 최종 번호 할당
  for (const w of existing) {
    const target = allEntries.findIndex((e) => e.id === w.id) + 1
    if (target > 0 && w.week_number !== target) {
      const { error } = await supabase
        .from('week')
        .update({ week_number: target })
        .eq('id', w.id)
      if (error) return err(error.message, 500)
    }
  }

  return ok({ ok: true, total: allEntries.length, added: toInsertDates.length })
}
