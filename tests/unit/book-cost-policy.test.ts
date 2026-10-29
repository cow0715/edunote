import { describe, expect, it } from 'vitest'
import { batchCostReservation, bookCostProtocol, BOOK_FILE_BUDGET_USD } from '@/lib/pdf-import/cost-policy'
import { estimateUsageRow } from '@/lib/costs/estimate'

describe('textbook cost policy', () => {
  it('defaults to the approved five-dollar file cap and reserves full output with input margin', () => {
    expect(BOOK_FILE_BUDGET_USD).toBe(5)
    expect(batchCostReservation('claude-sonnet-5-5', 10000, 12000)).toEqual({ inputLimit: 11256, maxOutputTokens: 12000, reservedUsd: 0.071256 })
    for (const n of [NaN, -1, 1.5]) expect(() => batchCostReservation('claude-sonnet-5-5', n, 10)).toThrow()
    expect(() => batchCostReservation('unknown', 100, 100)).toThrow()
  })
  it('pins protocol and routing without including transient execution IDs', () => {
    expect(bookCostProtocol(['map','audit','repair'],'routing-1')).toBe(bookCostProtocol(['map','audit','repair'],'routing-1'))
    expect(bookCostProtocol(['changed','audit','repair'],'routing-1')).not.toBe(bookCostProtocol(['map','audit','repair'],'routing-1'))
  })
  it('prices recorded Batch usage at half the standard rate', () => {
    const row = { provider: 'claude', feature: 'book.mapSource', model: 'claude-sonnet-5-5', calls: 1, units: 1,
      input_tokens: 1000000, output_tokens: 1000000, cache_read_tokens: 0, cache_write_tokens: 0 }
    expect(estimateUsageRow(row)?.amount).toBe(12)
    expect(estimateUsageRow({ ...row, service_tier: 'batch' })?.amount).toBe(6)
  })
})
