import { getAuth, err, ok } from '@/lib/api'
import { buildWeekDisplayMap, getWeekDisplayFallback, type ClassPeriod } from '@/lib/class-periods'

type MessageLogWeek = {
  id: string
  week_number: number
  start_date: string | null
  class_id: string
  class?: { id: string; name: string } | null
}

type MessageLogRow = {
  week?: MessageLogWeek | MessageLogWeek[] | null
  [key: string]: unknown
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

// 전송 내역 목록 조회
export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { searchParams } = new URL(request.url)
  const studentId = searchParams.get('student_id')
  const limitParam = searchParams.get('limit')
  const offsetParam = searchParams.get('offset')

  let query = supabase
    .from('message_log')
    .select('*, student(id, name, mother_phone, father_phone, phone), week(id, week_number, start_date, class_id, class(id, name))', { count: 'exact' })
    .order('sent_at', { ascending: false })

  if (studentId) query = query.eq('student_id', studentId)

  if (limitParam) {
    const limit = parseInt(limitParam)
    const offset = parseInt(offsetParam ?? '0')
    query = query.range(offset, offset + limit - 1)
  }

  const { data, error, count } = await query
  if (error) return err(error.message, 500)

  const logs = (data ?? []) as MessageLogRow[]
  const weeks = logs
    .map((log) => one(log.week))
    .filter((week): week is MessageLogWeek => !!week)
  const classIds = Array.from(new Set(weeks.map((week) => week.class_id).filter(Boolean)))

  let periods: ClassPeriod[] = []
  if (classIds.length > 0) {
    const { data: periodRows } = await supabase
      .from('class_period')
      .select('*')
      .in('class_id', classIds)
      .order('sort_order', { ascending: true })
    periods = (periodRows ?? []) as ClassPeriod[]
  }

  const displayMap = buildWeekDisplayMap(
    weeks.map((week) => ({
      id: week.id,
      class_id: week.class_id,
      week_number: week.week_number,
      start_date: week.start_date,
    })),
    periods,
  )

  const decoratedLogs = logs.map((log) => {
    const week = one(log.week)
    if (!week) return log
    return {
      ...log,
      week: {
        ...week,
        display_label: displayMap.get(week.id)?.displayLabel ?? getWeekDisplayFallback(week.week_number),
      },
    }
  })

  if (limitParam) return ok({ logs: decoratedLogs, total: count ?? 0 })
  return ok(decoratedLogs)
}

// 전송 완료 저장
export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { student_id, week_id, message } = await request.json()
  if (!student_id || !message) {
    return err('필수 항목 누락')
  }

  const { data, error } = await supabase
    .from('message_log')
    .insert({ student_id, week_id: week_id ?? null, message })
    .select()
    .single()

  if (error) return err(error.message, 500)
  return ok(data)
}
