import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), db: vi.fn() }))
vi.mock('@/lib/api', () => ({
  getAuth: mocks.auth, getTeacherAccess: mocks.access,
  err: (error: string, status = 400) => Response.json({ error }, { status }),
  ok: (data: unknown, init?: ResponseInit) => Response.json(data, init),
}))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.db }))
import { GET, POST, DELETE } from '@/app/api/admin/costs/route'
import { GET as getSync, POST as sync } from '@/app/api/admin/costs/sync/route'
import { costReportFixture } from '../fixtures/cost-report'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: 'teacher' }, supabase: {} })
  mocks.access.mockResolvedValue({ is_admin: true, approval_status: 'approved' })
})
describe('cost API authorization and failure handling', () => {
  it('denies signed-out users on every endpoint before accessing private data', async () => {
    mocks.auth.mockResolvedValue({ user: null, supabase: {} })
    for (const handler of [GET, POST, DELETE, getSync, sync]) expect((await handler(new Request('http://local/api?month=2026-10&environment=production'))).status).toBe(401)
    expect(mocks.db).not.toHaveBeenCalled()
  })
  it('denies approved non-admins and blocked admins', async () => {
    for (const access of [{ is_admin: false, approval_status: 'approved' }, { is_admin: true, approval_status: 'blocked' }]) {
      mocks.access.mockResolvedValue(access)
      expect((await GET(new Request('http://local/api?month=2026-10&environment=production'))).status).toBe(403)
    }
    expect(mocks.db).not.toHaveBeenCalled()
  })
  it('validates query, malformed JSON and deletion IDs before accessing storage', async () => {
    expect((await GET(new Request('http://local/api?month=bad&environment=production'))).status).toBe(400)
    expect((await POST(new Request('http://local/api', { method: 'POST', body: '{' }))).status).toBe(400)
    expect((await DELETE(new Request('http://local/api?id=bad'))).status).toBe(400)
    expect(mocks.db).not.toHaveBeenCalled()
  })
  it('reports unavailable storage as failure rather than an empty zero-cost result', async () => {
    mocks.db.mockImplementation(() => { throw new Error('private config') })
    const response = await GET(new Request('http://local/api?month=2026-10&environment=production'))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private config')
  })
  it('reads only app events after both organization coverage boundaries for the live addition', async () => {
    const report = costReportFixture()
    const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: [], error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: { report }, error: null }) }
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    mocks.db.mockReturnValue({ from: () => chain, rpc })
    const response = await GET(new Request('http://local/api?month=2026-10&environment=production'))
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenLastCalledWith('cost_usage_summary', { p_start: report.usageThrough, p_end: report.end, p_environment: 'production' })
    expect(await response.json()).toMatchObject({ claudeReport: { month: '2026-10', reported: 1 }, claudeTail: [] })
  })
})
