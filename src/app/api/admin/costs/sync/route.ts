import { err, ok } from '@/lib/api'
import { requireCostAdmin } from '@/lib/costs/admin'
import { monthSchema } from '@/lib/costs/model'
import { configuredCostProviders, syncCostMonth } from '@/lib/costs/sync'
import { createServiceClient } from '@/lib/supabase/service'

export const maxDuration = 60
export async function GET(request: Request) {
  const denied = await requireCostAdmin()
  if (denied) return denied
  const month = monthSchema.safeParse(new URL(request.url).searchParams.get('month'))
  if (!month.success) return err('조회 월을 확인해 주세요.')
  try {
    const { data, error } = await createServiceClient().from('cost_provider_snapshot').select('*').eq('month', month.data)
    if (error) return err('업체 조회 기록을 읽지 못했습니다. SQL 적용 여부를 확인해 주세요.', 503)
    return ok({ snapshots: data, configured: configuredCostProviders() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return err('업체 연결 상태를 읽지 못했습니다.', 503) }
}
export async function POST(request: Request) {
  const denied = await requireCostAdmin()
  if (denied) return denied
  const body = await request.json().catch(() => null)
  const month = monthSchema.safeParse(body?.month)
  if (!month.success) return err('조회 월을 확인해 주세요.')
  return syncCostMonth(month.data)
}
