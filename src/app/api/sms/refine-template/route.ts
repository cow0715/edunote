import { err, getAuth, getTeacherId, ok } from '@/lib/api'
import { refineSmsTemplateMessage } from '@/lib/anthropic'
import { SMS_RULES } from '@/lib/prompts'

export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('로그인이 필요합니다', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('관리자 승인 후 사용할 수 있습니다', 403)

  const body = await request.json().catch(() => ({}))
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  const rules = typeof body?.rules === 'string' && body.rules.trim() ? body.rules : SMS_RULES

  if (!text) return err('다듬을 메시지를 입력해 주세요')

  try {
    const refined = await refineSmsTemplateMessage(text, rules)
    return ok({ text: refined || text })
  } catch (e) {
    console.error('[POST /api/sms/refine-template]', e)
    return err('문구 다듬기에 실패했습니다', 500)
  }
}
