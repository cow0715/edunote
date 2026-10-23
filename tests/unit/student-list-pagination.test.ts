import { beforeEach, expect, it, vi } from 'vitest'
import { GET as students } from '@/app/api/students/route'
import { GET as roster } from '@/app/api/classes/[id]/students/route'
// These GET-only regressions do not exercise the server transaction used by POST.
vi.mock('@/lib/db/transaction', () => ({ withTeacherTransaction: vi.fn() }))
vi.mock('@/lib/services/students', () => ({ registerStudent: vi.fn(), enrollStudent: vi.fn() }))
const m = vi.hoisted(() => ({ auth: vi.fn(), teacher: vi.fn(), owner: vi.fn() }))
vi.mock('@/lib/api', () => ({ getAuth: m.auth, getTeacherId: m.teacher, assertClassOwner: m.owner,
  err: (error: string, status = 400) => Response.json({ error }, { status }), ok: (data: unknown) => Response.json(data) }))
beforeEach(() => { vi.clearAllMocks(); m.teacher.mockResolvedValue('teacher'); m.owner.mockResolvedValue(true) })
function database(rows: { id: number }[], failFrom = -1) {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), is: vi.fn(), range: vi.fn() }
  for (const key of ['select', 'eq', 'order', 'is'] as const) query[key].mockReturnValue(query)
  query.range.mockImplementation(async (from: number, to: number) => from === failFrom
    ? { data: null, error: { message: 'interrupted page' } } : { data: rows.slice(from, to + 1), error: null })
  const db = { from: vi.fn(() => query) }
  m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: db })
  return { db, query }
}
it('returns all 1056 students while retaining ownership and a unique sort tie-breaker', async () => {
  const rows = Array.from({ length: 1056 }, (_, id) => ({ id }))
  const { query } = database(rows)
  expect(await (await students()).json()).toEqual(rows)
  expect(query.eq).toHaveBeenCalledWith('teacher_id', 'teacher')
  expect(query.order).toHaveBeenCalledWith('id')
})
it('returns all 1050 active class enrollments and keeps the class authorization boundary', async () => {
  const rows = Array.from({ length: 1050 }, (_, id) => ({ id }))
  const { query } = database(rows)
  expect(await (await roster(new Request('http://local'), { params: Promise.resolve({ id: 'class' }) })).json()).toEqual(rows)
  expect(m.owner).toHaveBeenCalledWith(expect.anything(), 'class', 'teacher')
  expect(query.is).toHaveBeenCalledWith('left_at', null)
})
it('fails the whole list instead of silently returning the first 500 students', async () => {
  database(Array.from({ length: 800 }, (_, id) => ({ id })), 500)
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try { expect((await students()).status).toBe(500) } finally { log.mockRestore() }
})
it('does not query unauthenticated requests or another teachers roster', async () => {
  const { db } = database([])
  m.auth.mockResolvedValueOnce({ user: null })
  expect((await students()).status).toBe(401)
  m.owner.mockResolvedValue(false)
  expect((await roster(new Request('http://local'), { params: Promise.resolve({ id: 'other' }) })).status).toBe(403)
  expect(db.from).not.toHaveBeenCalled()
})
