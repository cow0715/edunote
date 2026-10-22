import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ db: vi.fn(), claude: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.db }))
vi.mock('@/lib/costs/connectors', () => ({ fetchClaudeCost: mocks.claude }))
import { syncCostMonth } from '@/lib/costs/sync'

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
})
