import { afterEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mock.create }))
import { costEnvironment, recordUsage } from '@/lib/costs/record'
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); mock.create.mockReset() })
describe('best effort usage recording', () => {
  it('does not access storage until explicitly enabled', async () => {
    vi.stubEnv('COST_TRACKING_ENABLED', 'false')
    await recordUsage({ provider: 'claude', feature: 'test' })
    expect(mock.create).not.toHaveBeenCalled()
  })
  it('does not fail the paid operation when recording fails', async () => {
    vi.stubEnv('COST_TRACKING_ENABLED', 'true')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mock.create.mockImplementation(() => { throw new Error('secret') })
    await expect(recordUsage({ provider: 'naver', feature: 'ocr' })).resolves.toBeUndefined()
    expect(warning).toHaveBeenCalledWith('[costs] usage_write_failed')
  })
  it('uses idempotent provider request IDs and bounded writes', async () => {
    vi.stubEnv('COST_TRACKING_ENABLED', 'true'); vi.stubEnv('COST_ENVIRONMENT', 'production')
    const upsert = vi.fn(() => ({ abortSignal: vi.fn().mockResolvedValue({ error: null }) }))
    mock.create.mockReturnValue({ from: () => ({ upsert }) })
    await recordUsage({ provider: 'claude', feature: 'parse', requestId: 'msg_123', inputTokens: 30 })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ request_id: 'msg_123', environment: 'production', input_tokens: 30 }), expect.objectContaining({ ignoreDuplicates: true }))
  })
  it('requires explicit environment for workers outside Vercel', () => {
    vi.stubEnv('COST_ENVIRONMENT', 'production')
    expect(costEnvironment()).toBe('production')
  })
})
