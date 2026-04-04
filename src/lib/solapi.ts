import { SolapiMessageService } from 'solapi'

const apiKey = process.env.SOLAPI_API_KEY!
const apiSecret = process.env.SOLAPI_API_SECRET!
const sender = process.env.SOLAPI_SENDER!

export type SendTarget = {
  studentId: string
  studentName: string
  recipientLabel: string  // '어머니' | '아버지' | '학생'
  phone: string
  message: string
}

export type SendResult = {
  studentId: string
  studentName: string
  recipientLabel: string
  phone: string
  message: string
  success: boolean
  error?: string
}

export async function sendMessages(targets: SendTarget[]): Promise<SendResult[]> {
  const service = new SolapiMessageService(apiKey, apiSecret)

  const settled = await Promise.allSettled(
    targets.map((t) =>
      service.sendOne({
        from: sender,
        to: t.phone.replace(/-/g, ''),
        text: t.message,
      })
    )
  )

  return targets.map((t, i) => {
    const result = settled[i]
    if (result.status === 'fulfilled') {
      return { ...t, success: true }
    }
    const msg = result.reason instanceof Error ? result.reason.message : '발송 실패'
    return { ...t, success: false, error: msg }
  })
}
