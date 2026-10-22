import { describe, expect, it } from 'vitest'
import { estimateUsage, estimateUsageRow, estimateMoney } from '@/lib/costs/estimate'
import type { UsageGroup } from '@/lib/costs/model'

const usage = (changes: Partial<UsageGroup> = {}): UsageGroup => ({ provider: 'claude', feature: 'week.parseAnswers', model: 'claude-sonnet-5', calls: 1, units: 1, input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_tokens: 1_000_000, cache_write_tokens: 1_000_000, ...changes })
describe('recorded usage cost estimates', () => {
  it('prices four disjoint token buckets without charging cached input twice', () => {
    expect(estimateUsageRow(usage())?.amount).toBeCloseTo(14.7)
    expect(estimateUsageRow(usage({ model: 'claude-sonnet-5-5' }))?.amount).toBeCloseTo(14.6)
    expect(estimateUsageRow(usage({ model: 'claude-opus-5-5' }))?.amount).toBeCloseTo(29.2)
    expect(estimateUsageRow(usage({ model: 'claude-haiku-4-5-20251001' }))?.amount).toBeCloseTo(7.35)
  })
  it('never treats unknown model versions or missing and invalid tokens as free', () => {
    for (const row of [usage({ model: 'claude-sonnet-6' }), usage({ model: 'claude-sonnet-5-5-future' }), usage({ input_tokens: NaN }), usage({ output_tokens: -1 }), usage({ cache_read_tokens: undefined as unknown as number })]) expect(estimateUsageRow(row)?.amount).toBeNull()
    const result = estimateUsage([usage(), usage({ model: 'future', calls: 5 })], 'claude')
    expect(result.amount).toBeCloseTo(14.7)
    expect(result.excludedCalls).toBe(5)
    expect(estimateUsage([], 'claude').amount).toBeNull()
  })
  it('calculates gross General text request cost without inventing remaining free account quota', () => {
    const result = estimateUsage([usage({ provider: 'naver', feature: '단어시험 사진 OCR 요청', units: 120 })], 'naver')
    expect(result.amount).toBe(360)
    expect(result.currency).toBe('KRW')
    expect(estimateUsageRow(usage({ provider: 'naver', feature: '표 OCR' }))?.amount).toBeNull()
    expect(estimateUsageRow(usage({ provider: 'gcp' }))).toBeNull()
  })
  it('preserves measured zero tokens and tiny positive costs', () => {
    expect(estimateUsageRow(usage({ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }))?.amount).toBe(0)
    expect(estimateMoney(0.0032, 'USD')).toContain('0.0032')
    expect(estimateMoney(0.000002, 'USD')).toBe('< US$0.0001')
  })
})
