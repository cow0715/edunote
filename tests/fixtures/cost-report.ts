import { buildClaudeReport } from '@/lib/costs/claude-report'
export const reportUsage = (input: number) => ({ model: 'claude-sonnet-5', service_tier: 'standard', inference_geo: 'global', uncached_input_tokens: input, output_tokens: 0, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } })
export const reportUsageBuckets = [
  { starting_at: '2026-10-01T00:00:00Z', ending_at: '2026-10-01T01:00:00Z', results: [reportUsage(500_000)] },
  { starting_at: '2026-10-02T00:00:00Z', ending_at: '2026-10-02T01:00:00Z', results: [reportUsage(250_000)] },
]
export const reportCostBuckets = [{ starting_at: '2026-10-01T00:00:00Z', ending_at: '2026-10-02T00:00:00Z', results: [{ model: 'claude-sonnet-5', currency: 'USD', amount: '100' }] }]
export const costReportFixture = () => buildClaudeReport('2026-10', reportUsageBuckets, reportCostBuckets, new Date('2026-10-03T00:00:00Z'))
