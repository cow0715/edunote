import { getAuth, err, ok } from '@/lib/api'
import { refineSmsTemplateMessage } from '@/lib/anthropic'
import { SMS_RULES } from '@/lib/prompts'

export async function POST(request: Request) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const body = await request.json().catch(() => ({}))
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  const rules = typeof body?.rules === 'string' && body.rules.trim() ? body.rules : SMS_RULES

  if (!text) return err('다듬을 공통 문구를 입력해주세요')

  try {
    const refined = await refineSmsTemplateMessage(text, rules)
    return ok({ text: refined || text })
  } catch (e) {
    console.error('[POST /api/sms/refine-template]', e)
    return err('문구 다듬기에 실패했습니다', 500)
  }
}
