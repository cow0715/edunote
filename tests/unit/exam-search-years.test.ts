import { describe, expect, it } from 'vitest'
import { examSearchYears } from '@/lib/exam-search-years'

describe('question search registered year bounds', () => {
  it('uses the minimum and maximum registered years in descending order', () => {
    const years = examSearchYears([2026, 2016, 2027, 2026])
    expect(years[0]).toBe(2027)
    expect(years.at(-1)).toBe(2016)
    expect(years).toHaveLength(12)
    expect(years).toContain(2020)
  })
  it('does not invent years for empty materials or a single year', () => {
    expect(examSearchYears([])).toEqual([])
    expect(examSearchYears([2025])).toEqual([2025])
  })
  it('ignores missing, invalid and fractional year values', () => {
    expect(examSearchYears([null, NaN, 2020.5, -1, 10000, 2026])).toEqual([2026])
  })
})
