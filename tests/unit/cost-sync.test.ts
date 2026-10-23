import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ db: vi.fn(), claude: vi.fn(), gcpCost: vi.fn(), gcpUsage: vi.fn(), solapi: vi.fn(), metrics: vi.fn(), developmentStorage: vi.fn() }))
vi.mock('@/lib/costs/supabase-storage', () => ({ fetchDevelopmentStorage: mocks.developmentStorage }))
vi.mock('@/lib/costs/supabase-metrics', () => ({ fetchSupabaseMetrics: mocks.metrics }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.db }))
vi.mock('@/lib/costs/claude-report-fetch', () => ({ fetchClaudeReport: mocks.claude }))
vi.mock('@/lib/costs/gcp-connector', () => ({ fetchGcpCost: mocks.gcpCost }))
vi.mock('@/lib/costs/gcp-worker-usage', () => ({ fetchGcpWorkerUsage: mocks.gcpUsage }))
vi.mock('@/lib/costs/solapi-connector', () => ({ fetchSolapiUsage: mocks.solapi }))
import { syncCostMonth } from '@/lib/costs/sync'
import { costReportFixture } from '../fixtures/cost-report'

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SOLAPI_API_KEY', 'VERCEL_BILLING_TOKEN', 'NCP_BILLING_ACCESS_KEY', 'GCP_BILLING_EXPORT_TABLE']) vi.stubEnv(key, '')
  vi.stubEnv('ANTHROPIC_ADMIN_KEY', 'test-key')
})
afterEach(() => vi.unstubAllEnvs())
describe('shared provider synchronization', () => {
  it.each([true, false])('stores a complete organization Storage total or keeps the previous total on read failure (%s)', async success => {
    vi.stubEnv('ANTHROPIC_ADMIN_KEY', ''); vi.stubEnv('COST_ENVIRONMENT', 'production'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://rjaawwrcgegfjtiztsou.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test')
    const chain = { select: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ error: null }), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { amount: 800, updated_at: '2026-10-22T00:00:00Z' } }), like: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(), delete: vi.fn().mockReturnThis(), upsert: vi.fn().mockResolvedValue({ error: null }) }
    mocks.db.mockReturnValue({ from: () => chain, rpc: () => ({ single: async () => ({ data: { db_bytes: 100, storage_bytes: 200, files: 2 } }) }) })
    mocks.metrics.mockResolvedValue({ connections: 4 })
    if (success) mocks.developmentStorage.mockResolvedValue({ storage_bytes: 300, files: 3, collected_at: '2026-10-23T00:00:00Z' })
    else mocks.developmentStorage.mockRejectedValue(new Error('unavailable'))
    expect(await (await syncCostMonth('2026-10')).json()).toMatchObject({ succeeded: success ? 1 : 0 })
    if (success) expect(chain.upsert).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ metric: 'storage_bytes_organization', amount: 500, status: 'ok' })]))
    else expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ metric: 'storage_bytes_organization', amount: 800, status: 'error', updated_at: '2026-10-22T00:00:00Z' }))
  })

  it.each([true, false])('collects official gauges independently and retains DB usage when metrics fail (%s)', async success => {
    vi.stubEnv('ANTHROPIC_ADMIN_KEY', ''); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test')
    const chain = { select: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ error: null }), eq: vi.fn().mockReturnThis(), like: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(), delete: vi.fn().mockReturnThis(), upsert: vi.fn().mockResolvedValue({ error: null }) }
    mocks.db.mockReturnValue({ from: () => chain, rpc: () => ({ single: async () => ({ data: { db_bytes: 100, storage_bytes: 200, files: 2 } }) }) })
    if (success) mocks.metrics.mockResolvedValue({ memory_used_bytes: 300, memory_total_bytes: 400, connections: 6, connection_limit: 60 })
    else mocks.metrics.mockRejectedValue(new Error('unavailable'))
    expect(await (await syncCostMonth('2026-10')).json()).toMatchObject({ succeeded: success ? 1 : 0, total: 1 })
    expect(chain.upsert).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ amount: 100, currency: 'BYTES' })]))
    if (success) expect(chain.upsert).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ metric: expect.stringMatching(/^metrics_connections_/), amount: 6, status: 'ok' })]))
    else { expect(chain.update).toHaveBeenCalledWith({ status: 'error' }); expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ metric: expect.stringMatching(/^metrics_status_/), amount: null, status: 'error' })) }
  })
  it('does not contact providers when storage is unavailable', async () => {
    const chain = { select: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ error: {} }) }
    mocks.db.mockReturnValue({ from: () => chain })
    expect((await syncCostMonth('2026-10')).status).toBe(503)
    expect(mocks.claude).not.toHaveBeenCalled()
  })
  it('keeps the last successful amount and timestamp when a provider fails', async () => {
    const chain = { select: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ error: null }),
      eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { provider: 'claude' } }),
      update: vi.fn().mockReturnThis(), upsert: vi.fn() }
    mocks.db.mockReturnValue({ from: () => chain })
    mocks.claude.mockRejectedValue(new Error('private provider details'))
    const response = await syncCostMonth('2026-10')
    expect(await response.json()).toMatchObject({ succeeded: 0, total: 1 })
    expect(chain.update).toHaveBeenCalledWith({ status: 'error' })
    expect(chain.upsert).not.toHaveBeenCalled()
  })
  it('saves organization history separately and keeps the settled snapshot separate from estimates', async () => {
    const chain = { select: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ error: null }), upsert: vi.fn().mockResolvedValue({ error: null }) }
    mocks.db.mockReturnValue({ from: () => chain })
    mocks.claude.mockResolvedValue(costReportFixture())
    expect(await (await syncCostMonth('2026-10')).json()).toMatchObject({ succeeded: 1, total: 1 })
    expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ month: '2026-10', report: expect.objectContaining({ pending: .5 }) }))
    expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ provider: 'claude', amount: 1 }))
  })
  it('saves worker usage even before the billing export has rows', async () => {
    vi.stubEnv('ANTHROPIC_ADMIN_KEY', '')
    for (const key of ['GCP_BILLING_EXPORT_TABLE', 'GCP_BILLING_SERVICE_ACCOUNT_EMAIL', 'GCP_WORKLOAD_IDENTITY_AUDIENCE', 'GCP_PROJECT_ID']) vi.stubEnv(key, 'configured')
    const chain = { select: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ error: null }), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null }), upsert: vi.fn().mockResolvedValue({ error: null }) }
    mocks.db.mockReturnValue({ from: () => chain })
    mocks.gcpUsage.mockResolvedValue({ worker_executions: 15, worker_succeeded: 14, worker_failed: 1, worker_running: 0, worker_wall_seconds: 2000 })
    mocks.gcpCost.mockRejectedValue(new Error('billing_data_unavailable'))
    expect(await (await syncCostMonth('2026-10')).json()).toMatchObject({ succeeded: 0, total: 1 })
    expect(chain.upsert).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ metric: 'worker_executions', amount: 15, status: 'ok' })]))
    expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ metric: 'monthly_cost', amount: null, status: 'error' }))
  })

  it('stores monthly SOLAPI spend and successful sends instead of treating wallet balance as spend', async () => {
    vi.stubEnv('ANTHROPIC_ADMIN_KEY', ''); vi.stubEnv('SOLAPI_API_KEY', 'test'); vi.stubEnv('SOLAPI_API_SECRET', 'test')
    const chain = { select: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ error: null }), upsert: vi.fn().mockResolvedValue({ error: null }) }
    mocks.db.mockReturnValue({ from: () => chain })
    mocks.solapi.mockResolvedValue({ monthly_cost: 12652.2, sms_succeeded: 330, sms_count: 124, point_usage: 10 })
    expect(await (await syncCostMonth('2026-10')).json()).toMatchObject({ succeeded: 1, total: 1 })
    expect(chain.upsert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ metric: 'monthly_cost', amount: 12652.2, currency: 'KRW' }),
      expect.objectContaining({ metric: 'sms_succeeded', amount: 330, currency: 'COUNT' }),
      expect.objectContaining({ metric: 'point_usage', currency: 'POINTS' }),
    ]))
  })

})
