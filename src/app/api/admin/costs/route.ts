import { z } from 'zod'
import { err, ok } from '@/lib/api'
import { requireCostAdmin } from '@/lib/costs/admin'
import { entrySchema, environments, monthBounds, monthSchema, type UsageGroup } from '@/lib/costs/model'
import { createServiceClient } from '@/lib/supabase/service'
import type { ClaudeReport } from '@/lib/costs/claude-report'

export async function GET(request: Request) {
  const denied = await requireCostAdmin()
  if (denied) return denied
  const query = new URL(request.url).searchParams
  const parsed = z.object({ month: monthSchema, environment: z.enum(environments) }).safeParse(Object.fromEntries(query))
  if (!parsed.success) return err('기간 또는 환경을 확인해 주세요.')
  try {
    const db = createServiceClient()
    const { month, environment } = parsed.data
    const bounds = monthBounds(month)
    const [entries, usage, stored] = await Promise.all([
      db.from('cost_entry').select('*').eq('month', month).eq('environment', environment).order('provider'),
      db.rpc('cost_usage_summary', { p_start: bounds.start, p_end: bounds.end, p_environment: environment }),
      db.from('cost_claude_report').select('report').eq('month', month).maybeSingle(),
    ])
    if (entries.error || usage.error || stored.error) return err('비용 데이터를 읽지 못했습니다. 비용 관리 SQL 적용과 서버 설정을 확인해 주세요.', 503)
    const claudeReport = (stored.data?.report ?? null) as ClaudeReport | null
    let claudeTail: UsageGroup[] = []
    if (claudeReport) {
      // Only requests AFTER both organization reports belong in the live addition.
      // Imported aggregates never become fake app events or duplicate existing requests.
      const from = new Date(Math.max(Date.parse(claudeReport.usageThrough), Date.parse(claudeReport.costThrough))).toISOString()
      if (from < claudeReport.end) {
        const tail = await db.rpc('cost_usage_summary', { p_start: from, p_end: claudeReport.end, p_environment: environment })
        if (tail.error) return err('최근 사용량 조회에 실패했습니다.', 503)
        claudeTail = tail.data ?? []
      }
    }
    return ok({ entries: entries.data, usage: usage.data, claudeReport, claudeTail, tracking: process.env.COST_TRACKING_ENABLED === 'true' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return err('비용 데이터 연결에 실패했습니다.', 503) }
}

export async function POST(request: Request) {
  const denied = await requireCostAdmin()
  if (denied) return denied
  const parsed = entrySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err('비용 입력값을 확인해 주세요.')
  try {
    const { error } = await createServiceClient().from('cost_entry').upsert({ ...parsed.data, source: 'manual', updated_at: new Date().toISOString() }, { onConflict: 'provider,environment,month,kind,currency' })
    if (error) return err('비용을 저장하지 못했습니다. SQL 적용 여부를 확인해 주세요.', 503)
    return ok({ saved: true })
  } catch { return err('비용 저장 연결에 실패했습니다.', 503) }
}

export async function DELETE(request: Request) {
  const denied = await requireCostAdmin()
  if (denied) return denied
  const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get('id'))
  if (!id.success) return err('삭제할 항목을 확인해 주세요.')
  try {
    const { error } = await createServiceClient().from('cost_entry').delete().eq('id', id.data)
    if (error) return err('비용을 삭제하지 못했습니다.', 503)
    return ok({ deleted: true })
  } catch { return err('비용 삭제 연결에 실패했습니다.', 503) }
}
