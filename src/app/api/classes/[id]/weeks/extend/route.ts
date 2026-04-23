import { getAuth, getTeacherId, assertClassOwner, err, ok } from '@/lib/api'

const DAY_MAP: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

// POST /api/classes/[id]/weeks/extend
// body: { count: number }
// 마지막 수업일 이후로 schedule_days에 맞는 날짜 N개를 추가하고, class.end_date를 연장한다.
// 기존 주차/데이터는 건드리지 않는다.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: classId } = await params
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertClassOwner(supabase, classId, teacherId)) return err('접근 권한 없음', 403)

  const body = await request.json().catch(() => ({}))
  const count = Number(body.count)
  if (!Number.isInteger(count) || count <= 0 || count > 52) {
    return err('추가 횟수가 올바르지 않습니다 (1~52)')
  }

  const { data: cls } = await supabase
    .from('class')
    .select('start_date, end_date, schedule_days')
    .eq('id', classId)
    .single()

  if (!cls) return err('수업 없음', 404)

  const scheduleDays: string[] = cls.schedule_days ?? []
  if (!scheduleDays.length) return err('요일 설정 없음')

  const dayNums = scheduleDays
    .map((d) => DAY_MAP[d])
    .filter((n): n is number => n !== undefined)
  if (!dayNums.length) return err('요일 설정이 올바르지 않습니다')
  const daySet = new Set(dayNums)

  // 기존 주차 중 최대 start_date와 최대 week_number 조회
  const { data: existingWeeks } = await supabase
    .from('week')
    .select('week_number, start_date')
    .eq('class_id', classId)

  const existing = existingWeeks ?? []
  const maxWeekNumber = existing.reduce((max, w) => Math.max(max, w.week_number ?? 0), 0)
  const maxDate = existing
    .map((w) => w.start_date)
    .filter((d): d is string => !!d)
    .reduce((max, d) => (d > max ? d : max), '')

  // 시작점: 최대 수업일 다음 날, 없으면 class.end_date 다음 날, 그것도 없으면 start_date
  const baseDateStr =
    maxDate ||
    (cls.end_date ? cls.end_date.slice(0, 10) : cls.start_date?.slice(0, 10) ?? '')
  if (!baseDateStr) return err('기준 날짜를 계산할 수 없습니다')

  const cursor = new Date(baseDateStr + 'T00:00:00Z')
  cursor.setUTCDate(cursor.getUTCDate() + 1)

  // 최대 2년 내에서 N개 수집
  const collected: string[] = []
  const hardLimit = 366 * 2
  for (let i = 0; i < hardLimit && collected.length < count; i++) {
    if (daySet.has(cursor.getUTCDay())) {
      collected.push(cursor.toISOString().slice(0, 10))
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  if (collected.length < count) {
    return err('요일 설정으로 추가할 날짜를 충분히 찾지 못했습니다', 500)
  }

  const lastNewDate = collected[collected.length - 1]

  // 새 주차 삽입
  const insertRows = collected.map((date, idx) => ({
    class_id: classId,
    week_number: maxWeekNumber + idx + 1,
    start_date: date,
    vocab_total: 0,
    homework_total: 0,
  }))

  const { error: insertError } = await supabase.from('week').insert(insertRows)
  if (insertError) return err(insertError.message, 500)

  // class.end_date를 마지막 새 수업일로 연장 (기존보다 늦을 때만)
  const currentEnd = cls.end_date ? cls.end_date.slice(0, 10) : ''
  if (!currentEnd || lastNewDate > currentEnd) {
    const { error: updateError } = await supabase
      .from('class')
      .update({ end_date: lastNewDate })
      .eq('id', classId)
    if (updateError) return err(updateError.message, 500)
  }

  return ok({ ok: true, added: collected.length, new_end_date: lastNewDate })
}
