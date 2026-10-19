import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withTeacherTransaction } from '@/lib/db/transaction'
import { dateInput, parseInput } from '@/lib/db/input'
import { saveErrorResponse } from '@/lib/db/errors'

const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), release: vi.fn(), where: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/pool', () => ({ getPool: () => ({ connect: mocks.connect }) }))
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: () => ({ select: () => ({ from: () => ({ where: mocks.where }) }) }) }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.query.mockResolvedValue({ rows: [] })
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release })
  mocks.where.mockResolvedValue([{ id: 'teacher' }])
})
describe('teacher transaction lifecycle', () => {
  it('sets transaction-local identity, commits, and releases the same client', async () => {
    expect(await withTeacherTransaction('user', async c => c.teacherId)).toBe('teacher')
    expect(mocks.query.mock.calls[0][0]).toBe('BEGIN')
    expect(mocks.query.mock.calls[1][1]).toEqual([JSON.stringify({ sub: 'user' }), 'user'])
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
    expect(mocks.release).toHaveBeenCalledWith(false)
  })
  it('rolls back a rejected operation and does not retry it', async () => {
    const work = vi.fn().mockRejectedValue(new Error('save failed'))
    await expect(withTeacherTransaction('user', work)).rejects.toThrow('save failed')
    expect(work).toHaveBeenCalledOnce()
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
    expect(mocks.release).toHaveBeenCalledWith(false)
  })
  it('rejects unapproved users before any work', async () => {
    mocks.where.mockResolvedValue([])
    const work = vi.fn()
    await expect(withTeacherTransaction('user', work)).rejects.toMatchObject({ status: 403 })
    expect(work).not.toHaveBeenCalled()
  })
  it('destroys connections when rollback fails', async () => {
    mocks.query.mockImplementation(async (query: string) => {
      if (query === 'ROLLBACK') throw new Error('connection lost')
      return { rows: [] }
    })
    await expect(withTeacherTransaction('user', async () => { throw new Error('save failed') })).rejects.toThrow('save failed')
    expect(mocks.release).toHaveBeenCalledWith(true)
  })
  it('does not repeat work after an unknown commit result', async () => {
    mocks.query.mockImplementation(async (query: string) => {
      if (query === 'COMMIT') throw new Error('connection lost')
      return { rows: [] }
    })
    const work = vi.fn().mockResolvedValue('done')
    await expect(withTeacherTransaction('user', work)).rejects.toThrow()
    expect(work).toHaveBeenCalledOnce()
    expect(mocks.release).toHaveBeenCalledWith(true)
  })
})

it('validates calendar dates, not just the date format', () => {
  expect(() => parseInput(dateInput, '2026-02-30')).toThrow()
  expect(parseInput(dateInput, '2024-02-29')).toBe('2024-02-29')
})
it('does not expose SQL/parameters through wrapped driver errors', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const response = saveErrorResponse({ message: 'SECRET SQL', cause: { code: '08006', detail: 'SECRET DATA' } })
  expect(response.status).toBe(503)
  expect(JSON.stringify(await response.json())).not.toContain('SECRET')
  expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET')
  spy.mockRestore()
})
