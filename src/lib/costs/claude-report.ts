import { z } from 'zod'
import { claudeTokenCost, estimateUsage } from './estimate'
import { monthSchema, type UsageGroup } from './model'

const tokens = z.number().finite().nonnegative()
const stamp = z.string().datetime({ offset: true })
const usageRow = z.object({
  model: z.string(), service_tier: z.string().nullable().optional(), inference_geo: z.string().nullable().optional(),
  speed: z.string().nullable().optional(), context_window: z.string().nullable().optional(),
  uncached_input_tokens: tokens, output_tokens: tokens, cache_read_input_tokens: tokens,
  cache_creation: z.object({ ephemeral_5m_input_tokens: tokens, ephemeral_1h_input_tokens: tokens }),
})
const costRow = z.object({ amount: z.string().regex(/^-?\d+(\.\d+)?$/), currency: z.string(), model: z.string().nullable().optional() })
export const usagePageSchema = z.object({ data: z.array(z.object({ starting_at: stamp, ending_at: stamp, results: z.array(usageRow) })), has_more: z.boolean(), next_page: z.string().nullable().optional() })
export const costPageSchema = z.object({ data: z.array(z.object({ starting_at: stamp, ending_at: stamp, results: z.array(costRow) })), has_more: z.boolean(), next_page: z.string().nullable().optional() })
export type ClaudeReport = {
  month: string; start: string; end: string; costThrough: string; usageThrough: string; fetchedAt: string;
  reported: number; pending: number; repriced: number; unpriced: number;
  days: { date: string; reported: number | null; estimate: number; partial: boolean }[];
  models: { model: string; reported: number; pending: number; estimate: number; input: number; output: number; read: number; write: number; writeHour: number }[];
}
export function claudeMonthBounds(month: string) {
  monthSchema.parse(month)
  const [year, index] = month.split('-').map(Number)
  return { start: new Date(Date.UTC(year, index - 1, 1)).toISOString(), end: new Date(Date.UTC(year, index, 1)).toISOString() }
}

/** Organization aggregates stay separate from app request events: no invented feature attribution. */
export function buildClaudeReport(month: string, usage: z.infer<typeof usagePageSchema>['data'], costs: z.infer<typeof costPageSchema>['data'], now = new Date()): ClaudeReport {
  const { start, end } = claudeMonthBounds(month)
  const valid = (bucket: { starting_at: string; ending_at: string }) => Date.parse(bucket.starting_at) >= Date.parse(start) && Date.parse(bucket.ending_at) <= Math.min(Date.parse(end), now.getTime()) && Date.parse(bucket.ending_at) > Date.parse(bucket.starting_at)
  if ((!usage.length && !costs.length) || [...usage, ...costs].some(bucket => !valid(bucket))) throw new Error('report_range_unavailable')
  const costThrough = new Date(Math.max(Date.parse(start), ...costs.map(b => Date.parse(b.ending_at)))).toISOString()
  const usageThrough = new Date(Math.max(Date.parse(start), ...usage.map(b => Date.parse(b.ending_at)))).toISOString()
  const models = new Map<string, ClaudeReport['models'][number]>()
  const days = new Map<string, ClaudeReport['days'][number]>()
  const model = (name: string) => { if (!models.has(name)) models.set(name, { model: name, reported: 0, pending: 0, estimate: 0, input: 0, output: 0, read: 0, write: 0, writeHour: 0 }); return models.get(name)! }
  const day = (date: string) => { const key = date.slice(0, 10); if (!days.has(key)) days.set(key, { date: key, reported: null, estimate: 0, partial: false }); return days.get(key)! }
  let reported = 0, pending = 0, repriced = 0, unpriced = 0
  for (const bucket of costs) {
    let amount = 0
    for (const row of bucket.results) {
      if (row.currency.toUpperCase() !== 'USD') throw new Error('unsupported_currency')
      const value = Number(row.amount) / 100
      if (!Number.isFinite(value)) throw new Error('invalid_amount')
      amount += value; model(row.model ?? '기타').reported += value
    }
    day(bucket.starting_at).reported = amount; reported += amount
  }
  for (const bucket of usage) {
    const daily = day(bucket.starting_at)
    for (const row of bucket.results) {
      const summary = model(row.model)
      summary.input += row.uncached_input_tokens; summary.output += row.output_tokens; summary.read += row.cache_read_input_tokens
      summary.write += row.cache_creation.ephemeral_5m_input_tokens; summary.writeHour += row.cache_creation.ephemeral_1h_input_tokens
      const amount = claudeTokenCost(row.model, { input: row.uncached_input_tokens, output: row.output_tokens, read: row.cache_read_input_tokens, write: row.cache_creation.ephemeral_5m_input_tokens, writeHour: row.cache_creation.ephemeral_1h_input_tokens }, { tier: row.service_tier, geo: row.inference_geo, speed: row.speed, context: row.context_window })
      // Some tiers (for example Priority) may also be absent from cost reports.
      // Flag unknown pricing even in earlier buckets rather than claiming a full total.
      if (amount === null) { unpriced++; daily.partial = true; continue }
      daily.estimate += amount; summary.estimate += amount; repriced += amount
      if (Date.parse(bucket.starting_at) >= Date.parse(costThrough)) { pending += amount; summary.pending += amount }
    }
  }
  return { month, start, end, costThrough, usageThrough, fetchedAt: now.toISOString(), reported, pending, repriced, unpriced, days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), models: [...models.values()].sort((a, b) => b.reported + b.pending - a.reported - a.pending) }
}

export function reconcileClaude(report: ClaudeReport, tail: UsageGroup[] = []) {
  const live = estimateUsage(tail, 'claude')
  return { reported: report.reported, pending: report.pending, live: live.amount ?? 0, total: report.reported + report.pending + (live.amount ?? 0), partial: report.unpriced > 0 || live.excludedCalls > 0 }
}
