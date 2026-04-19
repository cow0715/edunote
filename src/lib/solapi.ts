import { SolapiMessageService } from 'solapi'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const apiKey = process.env.SOLAPI_API_KEY!
const apiSecret = process.env.SOLAPI_API_SECRET!
const sender = process.env.SOLAPI_SENDER!

export type SendTarget = {
  studentId: string
  studentName: string
  recipientLabel: string  // '어머니' | '아버지' | '학생'
  phone: string
  message: string
  scheduledDate?: string  // ISO8601, e.g. '2026-04-05T09:00:00+09:00'
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
      service.send(
        [{ from: sender, to: t.phone.replace(/-/g, ''), text: t.message }],
        t.scheduledDate ? { scheduledDate: t.scheduledDate } : undefined
      )
    )
  )

  return targets.map((t, i) => {
    const result = settled[i]
    if (result.status === 'fulfilled') {
      const failed = result.value.failedMessageList ?? []
      if (failed.length > 0) {
        const f = failed[0] as { statusMessage?: string; reason?: string }
        return { ...t, success: false, error: f.statusMessage ?? f.reason ?? '발송 실패' }
      }
      return { ...t, success: true }
    }
    const msg = result.reason instanceof Error ? result.reason.message : '발송 실패'
    return { ...t, success: false, error: msg }
  })
}

export type MmsTarget = {
  studentId: string
  studentName: string
  recipientLabel: string
  phone: string
  subject?: string
  text?: string
}

export type MmsSendResult = MmsTarget & {
  success: boolean
  error?: string
}

export async function sendMmsWithBase64Image(
  target: MmsTarget,
  base64Png: string,
): Promise<MmsSendResult> {
  const service = new SolapiMessageService(apiKey, apiSecret)

  const cleaned = base64Png.replace(/^data:image\/\w+;base64,/, '')
  const buf = Buffer.from(cleaned, 'base64')

  if (buf.byteLength > 200 * 1024) {
    return { ...target, success: false, error: `이미지 크기 초과 (${Math.round(buf.byteLength / 1024)}KB > 200KB)` }
  }

  const tmpPath = join(tmpdir(), `report-${randomUUID()}.png`)
  await writeFile(tmpPath, buf)

  try {
    const upload = await service.uploadFile(tmpPath, 'MMS')
    const imageId = upload.fileId

    const result = await service.send([{
      from: sender,
      to: target.phone.replace(/-/g, ''),
      type: 'MMS',
      imageId,
      subject: target.subject ?? '월간 성적표',
      text: target.text ?? '월간 성적표가 도착했습니다.',
    }])

    const failed = result.failedMessageList ?? []
    if (failed.length > 0) {
      const f = failed[0] as { statusMessage?: string; reason?: string }
      return { ...target, success: false, error: f.statusMessage ?? f.reason ?? '발송 실패' }
    }
    return { ...target, success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '발송 실패'
    return { ...target, success: false, error: msg }
  } finally {
    await unlink(tmpPath).catch(() => {})
  }
}
