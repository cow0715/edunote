import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), teacher: vi.fn(), rpc: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/api', () => ({
  getAuth: mocks.auth, getTeacherId: mocks.teacher,
  err: (error: string, status = 400) => Response.json({ error }, { status }),
  ok: (data: unknown) => Response.json(data),
}))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }))
import { DELETE } from '@/app/api/exam-bank/[id]/route'
const request = new Request('https://example.com/api/exam-bank/exam', { method: 'DELETE' })
const params = { params: Promise.resolve({ id: 'exam' }) }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PDF_IMPORT_WORKER_ENABLED', 'true')
  mocks.auth.mockResolvedValue({ user: { id: 'auth' }, supabase: {} })
  mocks.teacher.mockResolvedValue('teacher')
  mocks.rpc.mockResolvedValue({ data: true, error: null })
})
afterEach(() => vi.unstubAllEnvs())
describe('exam deletion with durable imports', () => {
  it('authenticates before requesting an atomic exam/job deletion', async () => {
    expect((await DELETE(request, params)).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('pdf_import_delete_exam', { p_id: 'exam', p_teacher_id: 'teacher' })
    mocks.auth.mockResolvedValue({ user: null, supabase: {} })
    mocks.rpc.mockClear()
    expect((await DELETE(request, params)).status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('reports active workers and ownership failures instead of reporting success', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '55000' } })
    expect((await DELETE(request, params)).status).toBe(409)
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null })
    expect((await DELETE(request, params)).status).toBe(404)
  })
  it('preserves the old deletion path when worker mode is disabled', async () => {
    vi.stubEnv('PDF_IMPORT_WORKER_ENABLED', 'false')
    const query = { delete: () => { mocks.remove(); return query }, eq: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) }
    mocks.auth.mockResolvedValue({ user: { id: 'auth' }, supabase: { from: () => query } })
    expect((await DELETE(request, params)).status).toBe(200)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalled()
  })
})
