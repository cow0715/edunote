import { afterEach, describe, expect, it, vi } from 'vitest'

const sync = vi.hoisted(() => vi.fn())
vi.mock('@/lib/costs/sync', () => ({ syncCostMonth: sync }))
import { GET } from '@/app/api/cron/sync-costs/route'

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.clearAllMocks() })
describe('daily cost refresh', () => {
  it('fails closed when no secret is configured, including Bearer undefined', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(new Request('http://local', { headers: { authorization: 'Bearer undefined' } }))).status).toBe(401)
    expect(sync).not.toHaveBeenCalled()
  })
  it('rejects an incorrect credential before any provider calls', async () => {
    vi.stubEnv('CRON_SECRET', 'private-test-secret')
    expect((await GET(new Request('http://local', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401)
    expect(sync).not.toHaveBeenCalled()
  })
  it('refreshes both KST current and previous months across a year boundary', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-12-31T21:00:00Z'))
    vi.stubEnv('CRON_SECRET', 'private-test-secret')
    sync.mockImplementation(async () => Response.json({ succeeded: 3, total: 3 }))
    const response = await GET(new Request('http://local', { headers: { authorization: 'Bearer private-test-secret' } }))
    expect(response.status).toBe(200)
    expect(sync.mock.calls).toEqual([['2027-01'], ['2026-12']])
  })
  it('reports partial provider failures while still refreshing the previous month', async () => {
    vi.stubEnv('CRON_SECRET', 'private-test-secret')
    sync.mockImplementation(async () => Response.json({ succeeded: 2, total: 3 }))
    const response = await GET(new Request('http://local', { headers: { authorization: 'Bearer private-test-secret' } }))
    expect(response.status).toBe(503)
    expect(sync).toHaveBeenCalledTimes(2)
    expect(await response.text()).not.toContain('private-test-secret')
  })
})
