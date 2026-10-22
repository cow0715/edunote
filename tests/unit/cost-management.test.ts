import { afterEach, describe, expect, it, vi } from 'vitest'
import { entrySchema, koreanMonth, monthBounds, summarize, snapshotValue, snapshotLabel, type CostEntry } from '@/lib/costs/model'
import { parseClaudeCostPage, fetchClaudeCost } from '@/lib/costs/connectors'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const entry = (patch: Partial<CostEntry>): CostEntry => ({ id: 'id', provider: 'claude', environment: 'production', month: '2026-10', kind: 'estimate', currency: 'USD', amount: 20, note: '', source: 'manual', updated_at: '', ...patch })

describe('cost accounting', () => {
  it('keeps infrastructure measurements distinct from monetary amounts', () => {
    expect(snapshotValue(1048576, 'BYTES')).toBe('1 MiB')
    expect(snapshotValue(3, 'COUNT')).toBe('3개')
    expect(snapshotValue(null, 'USD')).toBe('조회값 없음')
    expect(snapshotLabel('db_bytes_production')).toBe('운영 DB 크기')
  })
  it('replaces estimates even with a zero actual and excludes topups and budgets', () => {
    const result = summarize([entry({}), entry({ kind: 'actual', amount: 0 }), entry({ provider: 'vercel', amount: 12 }), entry({ kind: 'topup', amount: 500 }), entry({ kind: 'budget', amount: 100 })])
    expect(result[1]).toEqual({ currency: 'USD', actual: 0, estimate: 12, total: 12, topup: 500, budget: 100 })
  })
  it('keeps currencies and provider estimates separate', () => {
    const result = summarize([entry({ kind: 'actual', amount: 10 }), entry({ amount: 50 }), entry({ currency: 'KRW', amount: 1000 })])
    expect(result.map(r => r.total)).toEqual([1000, 10])
  })
  it('rejects invalid months, negative amounts and unsupported providers', () => {
    for (const patch of [{ month: '2026-13' }, { amount: -1 }, { amount: Infinity }, { provider: 'openai' }]) expect(entrySchema.safeParse({ ...entry({}), ...patch }).success).toBe(false)
  })
  it('uses Korean calendar boundaries including leap years and new year', () => {
    expect(koreanMonth(new Date('2026-09-30T15:00:00Z'))).toBe('2026-10')
    expect(monthBounds('2024-02')).toEqual({ start: '2024-01-31T15:00:00.000Z', end: '2024-02-29T15:00:00.000Z' })
    expect(monthBounds('2026-12').end).toBe('2026-12-31T15:00:00.000Z')
  })
})
describe('Claude costs', () => {
  it('converts fractional cents to dollars without truncation', () => {
    expect(parseClaudeCostPage({ data: [{ results: [{ amount: '123.456', currency: 'USD' }, { amount: '10', currency: 'usd' }] }], has_more: false }).dollars).toBeCloseTo(1.33456)
  })
  it('rejects malformed reports instead of reporting zero', () => {
    expect(() => parseClaudeCostPage({})).toThrow()
    expect(() => parseClaudeCostPage({ data: [], has_more: true })).toThrow()
    expect(() => parseClaudeCostPage({ data: [{ results: [{ amount: '1', currency: 'EUR' }] }], has_more: false })).toThrow()
  })
  it('collects all pages and refuses a repeating pagination cursor', async () => {
    vi.stubEnv('ANTHROPIC_ADMIN_KEY', 'fake')
    const mock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ results: [{ amount: '100', currency: 'USD' }] }], has_more: true, next_page: 'p2' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ results: [{ amount: '250', currency: 'USD' }] }], has_more: false })))
    vi.stubGlobal('fetch', mock)
    expect(await fetchClaudeCost('2026-10')).toBe(3.5)
    expect(String(mock.mock.calls[1][0])).toContain('page=p2')
    mock.mockImplementation(async () => new Response(JSON.stringify({ data: [], has_more: true, next_page: 'same' })))
    await expect(fetchClaudeCost('2026-10')).rejects.toThrow('repeated_page')
  })
})
