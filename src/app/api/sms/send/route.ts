import { getAuth, err, ok } from '@/lib/api'
import { sendMessages, SendTarget } from '@/lib/solapi'

type MessageLogInsert = {
  student_id: string
  week_id: string | null
  message: string
}

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

  // The history tab is student-based, while one student can have multiple recipients.
  const successLogs = new Map<string, MessageLogInsert>()
  for (const r of results) {
    if (!r.success) continue
    const key = `${r.studentId}:${weekId ?? ''}:${r.message}`
    if (!successLogs.has(key)) {
      successLogs.set(key, {
        student_id: r.studentId,
        week_id: weekId ?? null,
        message: r.message,
      })
    }
  }

  if (successLogs.size > 0) {
    await supabase.from('message_log').insert(Array.from(successLogs.values()))
  }

  return ok(results)
}
