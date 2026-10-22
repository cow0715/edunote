import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ db: vi.fn(), claude: vi.fn(), gcpCost: vi.fn(), gcpUsage: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.db }))
vi.mock('@/lib/costs/claude-report-fetch', () => ({ fetchClaudeReport: mocks.claude }))
vi.mock('@/lib/costs/gcp-connector', () => ({ fetchGcpCost: mocks.gcpCost }))
vi.mock('@/lib/costs/gcp-worker-usage', () => ({ fetchGcpWorkerUsage: mocks.gcpUsage }))
import { syncCostMonth } from '@/lib/costs/sync'
import { costReportFixture } from '../fixtures/cost-report'

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SOLAPI_API_KEY', 'VERCEL_BILLING_TOKEN', 'NCP_BILLING_ACCESS_KEY', 'GCP_BILLING_EXPORT_TABLE']) vi.stubEnv(key, '')
  vi.stubEnv('ANTHROPIC_ADMIN_KEY', 'test-key')
})
afterEach(() => vi.unstubAllEnvs())
describe('shared provider synchronization', () => {
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

})
