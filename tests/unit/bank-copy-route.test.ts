import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ failFrom: -1, ranges: [] as number[][], filters: [] as string[][][] }))
vi.mock('@/lib/api', () => ({
  getTeacherId: async () => 'owner',
  err: (error: string) => Response.json({ error }, { status: 500 }),
  ok: (data: unknown) => Response.json(data),
  getAuth: async () => ({ user: { id: 'user' }, supabase: {
    from: (table: string) => {
      let from = 0, to = 499
      const filters: string[][] = []
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { filters.push([key, String(value)]); return query },
        gte: () => query, lte: () => query, like: () => query, textSearch: () => query,
        in: (key: string, value: string[]) => { filters.push([key, ...value]); return query },
        order: () => query,
        range: (a: number, b: number) => { from = a; to = b; state.ranges.push([a, b]); state.filters.push(filters); return query },
        then: (resolve: (value: unknown) => void) => Promise.resolve(table === 'exam_bank'
          ? { data: [{ id: 'owned-exam' }], error: null }
          : state.failFrom === from ? { data: null, count: 2091, error: { message: 'page failed' } }
            : { data: Array.from({ length: Math.min(to + 1, 2091) - from }, (_, i) => ({ id: String(from + i) })), count: 2091, error: null }).then(resolve),
      }
      return query
    },
  } }),
}))
import { GET } from '@/app/api/exam-bank/questions/route'

beforeEach(() => { state.failFrom = -1; state.ranges = []; state.filters = [] })
describe('bank export route preserves access and filters across every page', () => {
  it('returns all 2091 rows with the original filters on each owned query', async () => {
    const response = await GET(new Request('https://test/api/exam-bank/questions?all=1&type=purpose&points=2'))
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json.data).toHaveLength(2091)
    expect(json.total).toBe(2091)
    expect(state.ranges).toHaveLength(5)
    for (const filters of state.filters) {
      expect(filters).toContainEqual(['exam_bank_id', 'owned-exam'])
      expect(filters).toContainEqual(['question_type', 'purpose'])
      expect(filters).toContainEqual(['points', '2'])
    }
  })
  it('fails the export when a later page fails, instead of returning partial data', async () => {
    state.failFrom = 1000
    const response = await GET(new Request('https://test/api/exam-bank/questions?all=1'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'page failed' })
  })
})
