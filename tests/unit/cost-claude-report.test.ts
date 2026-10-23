import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildClaudeReport, claudeMonthBounds, reconcileClaude } from '@/lib/costs/claude-report'
import { claudeTokenCost } from '@/lib/costs/estimate'
import { fetchClaudeReport } from '@/lib/costs/claude-report-fetch'
import { costReportFixture, reportCostBuckets, reportUsage, reportUsageBuckets } from '../fixtures/cost-report'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('organization history and nonoverlapping cost reconciliation', () => {
  it('anchors reported history in cents and adds only usage after the cost report boundary', () => {
    const report = costReportFixture()
    expect(report.reported).toBe(1)
    expect(report.repriced).toBe(1.5)
    expect(report.pending).toBe(0.5)
    expect(reconcileClaude(report).total).toBe(1.5)
    expect(report.models[0]).toMatchObject({ reported: 1, pending: .5, input: 750_000 })
    expect(report.days[0].reported).toBe(1)
    expect(report.days[1].reported).toBeNull()
    const total = reconcileClaude(report, [{ provider: 'claude', feature: 'live', model: 'claude-sonnet-5', calls: 1, units: 1, input_tokens: 100_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }])
    expect(total.total).toBeCloseTo(1.7)
    expect(total.live).toBeCloseTo(.2)
  })
  it('uses UTC months and rejects data outside the month or in a future bucket', () => {
    expect(claudeMonthBounds('2026-10').start).toBe('2026-10-01T00:00:00.000Z')
    expect(() => buildClaudeReport('2026-11', reportUsageBuckets, reportCostBuckets)).toThrow('report_range_unavailable')
    expect(() => buildClaudeReport('2026-10', reportUsageBuckets, reportCostBuckets, new Date('2026-10-01T00:30:00Z'))).toThrow()
  })
  it('can estimate on the first day without claiming a settled zero and flags unknown pending rates', () => {
    const report = buildClaudeReport('2026-10', [reportUsageBuckets[0]], [], new Date('2026-10-01T02:00:00Z'))
    expect(report.costThrough).toBe(report.start)
    expect(reconcileClaude(report).total).toBe(1)
    const unknown = buildClaudeReport('2026-10', [{ ...reportUsageBuckets[1], results: [{ ...reportUsage(100), model: 'unknown' }] }], reportCostBuckets, new Date('2026-10-03T00:00:00Z'))
    expect(reconcileClaude(unknown).partial).toBe(true)
    const priority = buildClaudeReport('2026-10', [{ ...reportUsageBuckets[0], results: [{ ...reportUsage(100), service_tier: 'priority' }] }], reportCostBuckets, new Date('2026-10-03T00:00:00Z'))
    expect(reconcileClaude(priority).partial).toBe(true)
  })
  it('accounts for hourly cache, batch and geography without guessing unsupported tiers', () => {
    expect(claudeTokenCost('claude-sonnet-5', { input: 0, output: 0, read: 0, write: 0, writeHour: 1_000_000 })).toBe(4)
    expect(claudeTokenCost('claude-sonnet-5', { input: 1_000_000, output: 0, read: 0, write: 0 }, { tier: 'batch', geo: 'us' })).toBeCloseTo(1.1)
    expect(claudeTokenCost('claude-sonnet-5', { input: 1, output: 0, read: 0, write: 0 }, { tier: 'priority' })).toBeNull()
  })
  it('downloads every usage page, preserving bucket coverage without storing keys or prompts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-03T00:00:00Z'))
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/cost_report')) return Response.json({ data: reportCostBuckets, has_more: false })
      return Response.json(url.searchParams.has('page') ? { data: [reportUsageBuckets[1]], has_more: false } : { data: [reportUsageBuckets[0]], has_more: true, next_page: 'second' })
    })
    vi.stubGlobal('fetch', fetcher)
    const report = await fetchClaudeReport('2026-10')
    expect(report.pending).toBe(.5)
    expect(fetcher).toHaveBeenCalledTimes(3)
    const urls = fetcher.mock.calls.map(([url]) => new URL(url))
    expect(urls.some(url => url.searchParams.get('bucket_width') === '1h' && url.searchParams.get('limit') === '168')).toBe(true)
    expect(JSON.stringify(report)).not.toContain('api_key_id')
  })
  it('fails closed on repeated pagination and provider failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => Response.json({ data: input.includes('/cost_report') ? reportCostBuckets : [reportUsageBuckets[0]], has_more: !input.includes('/cost_report'), next_page: 'loop' })))
    await expect(fetchClaudeReport('2026-10')).rejects.toThrow('invalid_pagination')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })))
    await expect(fetchClaudeReport('2026-10')).rejects.toThrow('provider_read_failed')
  })
})
