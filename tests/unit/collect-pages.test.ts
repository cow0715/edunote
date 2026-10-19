import { expect, it, vi } from 'vitest'
import { collectPages } from '@/lib/collect-pages'
it('collects beyond 1000 rows without losing a final partial page', async () => {
  const rows = Array.from({ length: 1056 }, (_, id) => ({ id }))
  const page = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }))
  expect(await collectPages(page)).toEqual(rows)
  expect(page.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]])
})
it('does not return partial success when a later page fails', async () => {
  const page = vi.fn().mockResolvedValueOnce({ data: [1, 2], error: null }).mockResolvedValueOnce({ data: null, error: { message: 'network' } })
  await expect(collectPages(page, 2)).rejects.toThrow('network')
})
it('handles exact pages, empty results and invalid sizes', async () => {
  expect(await collectPages(async () => ({ data: [], error: null }))).toEqual([])
  await expect(collectPages(async () => ({ data: [], error: null }), 0)).rejects.toThrow('Invalid')
})
