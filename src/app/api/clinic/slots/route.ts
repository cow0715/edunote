import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { ClinicWeekday } from '@/lib/types'

const WEEKDAYS: ClinicWeekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function isValidTime(value: unknown) {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const body = await request.json().catch(() => ({})) as {
    slots?: {
      weekday?: ClinicWeekday
      starts_at?: string
      ends_at?: string
      is_active?: boolean
    }[]
  }
  if (!Array.isArray(body.slots)) return err('요일 설정이 필요합니다')

  const rows = body.slots.map((slot) => {
    if (!slot.weekday || !WEEKDAYS.includes(slot.weekday)) throw new Error('잘못된 요일입니다')
    if (!isValidTime(slot.starts_at) || !isValidTime(slot.ends_at)) throw new Error('시간 형식이 올바르지 않습니다')
    if (slot.ends_at! <= slot.starts_at!) throw new Error('종료 시간은 시작 시간보다 늦어야 합니다')
    return {
      teacher_id: teacherId,
      weekday: slot.weekday,
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      is_active: !!slot.is_active,
    }
  })

  try {
    const { data, error } = await supabase
      .from('clinic_slot')
      .upsert(rows, { onConflict: 'teacher_id,weekday' })
      .select('*')

    if (error) return err(error.message, 500)
    return ok({ slots: data ?? [] })
  } catch (e) {
    return err(e instanceof Error ? e.message : '요일 설정 저장 실패')
  }
}

export const PATCH = POST
