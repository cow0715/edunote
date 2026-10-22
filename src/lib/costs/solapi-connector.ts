import { SolapiMessageService } from 'solapi'
import { z } from 'zod'
import { monthBounds } from './model'

const money = z.number().finite()
const counts = z.record(z.string(), z.number().int().nonnegative())
const statistics = z.object({ balance: money, deposit: money.optional(), point: money, refund: z.object({ balance: money, deposit: money.optional(), point: money }).optional(), total: counts, successed: counts, failed: counts })
const total = (counts: Record<string, number>) => counts.total ?? Object.entries(counts).filter(([key]) => key !== 'total').reduce((n, [, value]) => n + value, 0)
export function parseSolapiStatistics(input: unknown) {
  const data = statistics.parse(input)
  const sms = (value: Record<string, number>) => ['sms', 'lms', 'mms'].reduce((n, type) => n + (value[type] ?? 0), 0)
  if (total(data.successed) + total(data.failed) > total(data.total)) throw new Error('inconsistent_message_counts')
  // Statistics amounts are the provider's period usage values, NOT the current wallet balance.
  // Deposit is a separate funding bucket. Refund is already reflected by the provider: do not subtract twice.
  return {
    monthly_cost: Math.round((data.balance + (data.deposit ?? 0)) * 1e6) / 1e6,
    message_total: total(data.total), message_succeeded: total(data.successed), message_failed: total(data.failed),
    sms_succeeded: sms(data.successed), sms_failed: sms(data.failed),
    sms_count: data.successed.sms ?? 0, lms_count: data.successed.lms ?? 0, mms_count: data.successed.mms ?? 0,
    cash_usage: data.balance, deposit_usage: data.deposit ?? 0, point_usage: data.point,
    cash_refund: (data.refund?.balance ?? 0) + (data.refund?.deposit ?? 0), point_refund: data.refund?.point ?? 0,
  }
}
export async function fetchSolapiUsage(month: string, now = new Date()) {
  const bounds = monthBounds(month)
  const end = new Date(Math.min(Date.parse(bounds.end) - 1, now.getTime()))
  if (end.getTime() < Date.parse(bounds.start)) throw new Error('future_month')
  const client = new SolapiMessageService(process.env.SOLAPI_API_KEY!, process.env.SOLAPI_API_SECRET!)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([client.getStatistics({ startDate: bounds.start, endDate: end }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('provider_timeout')), 10000) })])
    return parseSolapiStatistics(result)
  } finally { clearTimeout(timer) }
}
