import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as setDefault } from '@/app/api/classes/[id]/periods/[periodId]/activate/route'
import { PATCH as edit, DELETE as remove } from '@/app/api/classes/[id]/periods/[periodId]/route'
import { POST as create } from '@/app/api/classes/[id]/periods/route'
import { SaveError } from '@/lib/db/errors'

const mocks = vi.hoisted(() => ({ save: vi.fn(), transaction: vi.fn(), auth: vi.fn(), context: { tx: {}, teacherId: 'teacher' } }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/transaction', () => ({ withTeacherTransaction: mocks.transaction }))
vi.mock('@/lib/services/class-periods', () => ({ managePeriod: mocks.save }))
vi.mock('@/lib/api', () => ({
  getAuth: mocks.auth,
  getTeacherId: vi.fn(async () => 'teacher'),
  assertClassOwner: vi.fn(),
  err: (error: string, status = 400) => Response.json({ error }, { status }),
  ok: (value: unknown, init?: ResponseInit) => Response.json(value, init),
}))
const context = { params: Promise.resolve({ id: 'class', periodId: 'old' }) }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: 'user' } })
  mocks.transaction.mockImplementation(async (_id, work) => work(mocks.context))
  mocks.save.mockResolvedValue({ id: 'old' })
})
describe('period mutation API boundaries', () => {
  it('uses the atomic default operation without sending any date changes', async () => {
    const response = await setDefault(new Request('http://local'), context)
    expect(response.status).toBe(200)
    expect(mocks.transaction).toHaveBeenCalledWith('user', expect.any(Function))
    expect(mocks.save).toHaveBeenCalledWith(mocks.context, 'class', 'set_default', 'old')
  })
  it('blocks unauthorized changes before calling the database operation', async () => {
    mocks.transaction.mockRejectedValue(new SaveError('접근 권한 없음', 403))
    expect((await setDefault(new Request('http://local'), context)).status).toBe(403)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('returns a conflict when the database rejects deletion of the shared default', async () => {
    mocks.save.mockRejectedValue(new SaveError('다른 기간을 공유 기본으로 지정한 뒤 삭제해 주세요', 409))
    expect((await remove(new Request('http://local'), context)).status).toBe(409)
  })
  it('does not let the ordinary edit endpoint quietly change the shared default', async () => {
    mocks.save.mockRejectedValue(new SaveError('공유 기본 지정은 별도 메뉴를 이용해 주세요'))
    const response = await edit(new Request('http://local', { method: 'PATCH', body: JSON.stringify({ label: 'renamed', is_current: true }) }), context)
    expect(response.status).toBe(400)
    expect(mocks.save).toHaveBeenCalledOnce()
  })
  it('creates with one transactional call and surfaces a chronology validation error', async () => {
    mocks.save.mockRejectedValue(new SaveError('새 기간은 가장 최근 기간의 시작일 이후에 시작해 주세요'))
    const response = await create(new Request('http://local', { method: 'POST', body: JSON.stringify({ label: 'period', semester: 1, exam_type: 'final', start_date: '2026-07-01' }) }), context)
    expect(response.status).toBe(400)
    expect(mocks.save).toHaveBeenCalledOnce()
  })
  it('does not allocate a database connection for an unauthenticated request', async () => {
    mocks.auth.mockResolvedValue({ user: null })
    expect((await create(new Request('http://local'), context)).status).toBe(401)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
