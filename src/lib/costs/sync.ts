import { SolapiMessageService } from 'solapi'
import { err, ok } from '@/lib/api'
import { fetchClaudeReport } from '@/lib/costs/claude-report-fetch'
import { fetchVercelCost, fetchNaverCost } from '@/lib/costs/cloud-connectors'
import { fetchGcpCost } from '@/lib/costs/gcp-connector'
import { createServiceClient } from '@/lib/supabase/service'
import { costEnvironment } from '@/lib/costs/record'

export function configuredCostProviders() {
  return [
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : '',
    process.env.ANTHROPIC_ADMIN_KEY ? 'claude' : '',
    process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET ? 'solapi' : '',
    process.env.VERCEL_BILLING_TOKEN && process.env.VERCEL_BILLING_TEAM_ID ? 'vercel' : '',
    process.env.NCP_BILLING_ACCESS_KEY && process.env.NCP_BILLING_SECRET_KEY ? 'naver' : '',
    process.env.GCP_BILLING_EXPORT_TABLE && process.env.GCP_BILLING_SERVICE_ACCOUNT_EMAIL && process.env.GCP_WORKLOAD_IDENTITY_AUDIENCE && process.env.GCP_PROJECT_ID ? 'gcp' : '',
  ].filter(Boolean)
}
export async function syncCostMonth(month: string) {
  const enabled = configuredCostProviders()
  if (!enabled.length) return ok({ message: '자동 조회 자격 증명이 없습니다. 비용은 수동 등록할 수 있습니다.' })
  try {
    const db = createServiceClient()
    // Require storage first so a missing migration does not trigger provider calls.
    const ready = await db.from('cost_provider_snapshot').select('provider').limit(1)
    if (ready.error) return err('비용 관리 SQL을 먼저 적용해 주세요.', 503)
    const results = await Promise.all(enabled.map(async provider => {
      const metric = provider === 'solapi' ? 'balance' : provider === 'supabase' ? 'infrastructure' : 'monthly_cost'
      try {
        if (provider === 'supabase') {
          const result = await db.rpc('cost_infrastructure_usage').single()
          if (result.error || !result.data) throw new Error('usage_read_failed')
          const usage = result.data as { db_bytes: number; storage_bytes: number; files: number }
          const rows = Object.entries(usage).map(([key, value]) => ({ provider, month: month,
            metric: `${key}_${costEnvironment()}`, currency: key === 'files' ? 'COUNT' : 'BYTES',
            amount: Number(value), status: 'ok', updated_at: new Date().toISOString(),
          }))
          if (rows.some(row => !Number.isFinite(row.amount))) throw new Error('invalid_usage')
          const saved = await db.from('cost_provider_snapshot').upsert(rows)
          if (saved.error) throw new Error('snapshot_write_failed')
          await db.from('cost_provider_snapshot').delete().eq('provider', provider).eq('month', month).eq('metric', 'infrastructure')
          return true
        }
        let amount: number
        let gcpCurrency: string | undefined
        if (provider === 'claude') {
          const report = await fetchClaudeReport(month)
          const saved = await db.from('cost_claude_report').upsert({ month, report, updated_at: report.fetchedAt })
          if (saved.error) throw new Error('report_write_failed')
          if (report.costThrough === report.start) throw new Error('cost_data_pending')
          amount = report.reported
        }
        else if (provider === 'vercel') amount = await fetchVercelCost(month)
        else if (provider === 'naver') amount = await fetchNaverCost(month)
        else if (provider === 'gcp') {
          const value = await fetchGcpCost(month)
          amount = value.amount; gcpCurrency = value.currency
        }
        else {
          const client = new SolapiMessageService(process.env.SOLAPI_API_KEY!, process.env.SOLAPI_API_SECRET!)
          // SOLAPI SDK has no AbortSignal option. Bound the response wait without logging its raw error.
          let timer: ReturnType<typeof setTimeout> | undefined
          const balance = await Promise.race([client.getBalance(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('provider_timeout')), 8000) })]).finally(() => clearTimeout(timer))
          amount = balance.balance
        }
        if (!Number.isFinite(amount)) throw new Error('invalid_amount')
        const currency = gcpCurrency ?? (provider === 'claude' || provider === 'vercel' ? 'USD' : 'KRW')
        const { error } = await db.from('cost_provider_snapshot').upsert({ provider, month: month, metric, amount, currency, status: 'ok', updated_at: new Date().toISOString() })
        if (error) throw new Error('snapshot_write_failed')
        return true
      } catch {
        // Keep the last successful value and its timestamp; show failure on first connection too.
        const existing = await db.from('cost_provider_snapshot').select('provider').eq('provider', provider).eq('month', month).eq('metric', metric).maybeSingle()
        if (existing.data) await db.from('cost_provider_snapshot').update({ status: 'error' }).eq('provider', provider).eq('month', month).eq('metric', metric)
        else await db.from('cost_provider_snapshot').upsert({ provider, month: month, metric, amount: null, currency: provider === 'claude' || provider === 'vercel' ? 'USD' : 'KRW', status: 'error' })
        return false
      }
    }))
    return ok({ succeeded: results.filter(Boolean).length, total: enabled.length, message: `${results.filter(Boolean).length}/${enabled.length}개 업체 조회 성공. 실패 시 이전 값을 유지합니다.` })
  } catch { return err('업체 동기화 저장에 실패했습니다.', 503) }
}
