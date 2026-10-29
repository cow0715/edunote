import { describe, expect, it, vi } from 'vitest'
import { assertCompleteBankCopy, collectBankCopyRows, fetchAllBankCopyRows } from '@/lib/bank-copy-pagination'

describe('complete question bank export', () => {
  const rows = Array.from({ length: 2091 }, (_, i) => ({ id: String(i) }))
  it('collects all 2091 rows with inclusive ranges below the server limit', async () => {
    const fetch = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), count: rows.length, error: null }))
    expect(await collectBankCopyRows(fetch)).toEqual({ data: rows, total: 2091 })
    expect(fetch.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499], [1500, 1999], [2000, 2499]])
  })
  it('rejects a later page error instead of returning the first 1000 rows', async () => {
    await expect(collectBankCopyRows(async (from, to) => ({
      data: from < 1000 ? rows.slice(from, to + 1) : null, count: 2091,
      error: from >= 1000 ? { message: 'network failed' } : null,
    }))).rejects.toThrow('network failed')
  })
  it('rejects missing, duplicate or changed pages', async () => {
    await expect(collectBankCopyRows(async () => ({ data: [], count: 2091, error: null }))).rejects.toThrow('누락')
    await expect(collectBankCopyRows(async () => ({ data: [{ id: 'same' }], count: 2, error: null }))).rejects.toThrow('중복')
    await expect(collectBankCopyRows(async (from, to) => ({ data: rows.slice(from, to + 1), count: from ? 2090 : 2091, error: null }))).rejects.toThrow('변경')
    await expect(collectBankCopyRows(async () => ({ data: [], count: null, error: null }))).rejects.toThrow('문항 수')
  })
  it('allows empty results but prevents stale UI totals or a truncated response being copied', async () => {
    expect(await collectBankCopyRows(async () => ({ data: [], count: 0, error: null }))).toEqual({ data: [], total: 0 })
    expect(() => assertCompleteBankCopy(rows.slice(0, 1000), 2091, 2091)).toThrow()
    expect(() => assertCompleteBankCopy(rows, 2091, 2090)).toThrow()
    expect(assertCompleteBankCopy(rows, 2091, 2091)).toBe(rows)
  })
  it('fetches every HTTP page with the same filters and no oversized all=1 response', async () => {
    const urls: string[] = []
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); urls.push(url)
      const params = new URL(url, 'https://test').searchParams
      const page = Number(params.get('page'))
      return Response.json({ data: rows.slice(page * 200, (page + 1) * 200), total: page === 0 ? 2091 : undefined })
    })
    expect(await fetchAllBankCopyRows('source=교재&q=word', 2091, request)).toEqual(rows)
    expect(urls).toHaveLength(11)
    for (const url of urls) {
      const p = new URL(url, 'https://test').searchParams
      expect(p.get('source')).toBe('교재'); expect(p.get('q')).toBe('word')
      expect(p.get('limit')).toBe('200'); expect(p.has('all')).toBe(false)
    }
    await expect(fetchAllBankCopyRows('', 2091, async () => Response.json({ data: rows.slice(0, 100), total: 2091 }))).rejects.toThrow('누락')
  })
})
