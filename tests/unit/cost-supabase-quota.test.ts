import { describe, expect, it } from 'vitest'
import { quotaUsage, SUPABASE_FREE_DB_BYTES } from '@/lib/costs/supabase-quota'
describe('Free allowance references and warning thresholds', () => {
  it.each([[.79999, '여유'], [.8, '주의'], [.9, '임박'], [1, '초과'], [1.2, '초과']])('classifies the unrounded ratio at %s', (ratio, level) => {
    expect(quotaUsage(Number(ratio) * SUPABASE_FREE_DB_BYTES, SUPABASE_FREE_DB_BYTES)?.level).toBe(level)
  })
  it('keeps actual overage visible but caps the bar and remaining capacity', () => {
    expect(quotaUsage(600_000_000, SUPABASE_FREE_DB_BYTES)).toEqual({ percent: 120, bar: 100, remaining: 0, level: '초과', warning: true })
    expect(quotaUsage(399_995_000, SUPABASE_FREE_DB_BYTES)?.percent).toBe(79.9)
  })
  it('distinguishes missing or invalid usage from a measured zero', () => {
    for (const value of [null, undefined, NaN, Infinity, -1]) expect(quotaUsage(value, SUPABASE_FREE_DB_BYTES)).toBeNull()
    expect(quotaUsage(0, SUPABASE_FREE_DB_BYTES)).toMatchObject({ percent: 0, remaining: SUPABASE_FREE_DB_BYTES, warning: false })
  })
})
