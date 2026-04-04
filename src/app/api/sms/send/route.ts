import { getAuth, err, ok } from '@/lib/api'
import { sendMessages, SendTarget } from '@/lib/solapi'

export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { targets, weekId, scheduledDate } = await request.json() as {
    targets: SendTarget[]
    weekId?: string
    scheduledDate?: string
  }

  if (!targets || targets.length === 0) return err('발송 대상 없음')

  const targetsWithSchedule = targets.map((t) => ({ ...t, scheduledDate }))
  const results = await sendMessages(targetsWithSchedule)

  // 예약 발송이 아닌 경우에만 성공 건 즉시 message_log 저장
  if (!scheduledDate) {
    const successTargets = results.filter((r) => r.success)
    if (successTargets.length > 0) {
      await supabase.from('message_log').insert(
        successTargets.map((r) => ({
          student_id: r.studentId,
          week_id: weekId ?? null,
          message: r.message,
        }))
      )
    }
  }

  return ok(results)
}
