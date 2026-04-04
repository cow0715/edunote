import { getAuth, err, ok } from '@/lib/api'
import { sendMessages, SendTarget } from '@/lib/solapi'

export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { targets, weekId } = await request.json() as {
    targets: SendTarget[]
    weekId?: string
  }

  if (!targets || targets.length === 0) return err('발송 대상 없음')

  const results = await sendMessages(targets)

  // 성공한 것만 message_log에 저장
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

  return ok(results)
}
