import { timingSafeEqual } from 'node:crypto'
import { koreanMonth } from '@/lib/costs/model'
import { syncCostMonth } from '@/lib/costs/sync'

export const maxDuration = 180
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const expected = Buffer.from(`Bearer ${secret ?? ''}`)
  const supplied = Buffer.from(request.headers.get('authorization') ?? '')
  if (!secret || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return Response.json({ error: '인증 실패' }, { status: 401 })
  }
  // Refresh the previous month too: provider reporting and invoices can arrive late.
  const month = koreanMonth()
  const [year, index] = month.split('-').map(Number)
  const previous = new Date(Date.UTC(year, index - 2, 15))
  const months = [month, koreanMonth(previous)]
  const reports = []
  for (const value of months) {
    const response = await syncCostMonth(value)
    const result = await response.json()
    reports.push({ month: value, ok: response.ok && result.total > 0 && result.succeeded === result.total,
      succeeded: result.succeeded ?? 0, total: result.total ?? 0 })
  }
  return Response.json({ reports }, { status: reports.every(report => report.ok) ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' } })
}
