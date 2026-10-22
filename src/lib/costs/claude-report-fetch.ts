import { buildClaudeReport, claudeMonthBounds, costPageSchema, usagePageSchema } from './claude-report'

export async function fetchClaudeReport(month: string) {
  const bounds = claudeMonthBounds(month)
  const now = new Date()
  const deadline = AbortSignal.timeout(45000)
  async function pages(path: string, hourly: boolean, groups: string[]) {
    const query = new URLSearchParams({ starting_at: bounds.start, ending_at: new Date(Math.min(now.getTime(), Date.parse(bounds.end))).toISOString(), bucket_width: hourly ? '1h' : '1d', limit: hourly ? '168' : '31' })
    for (const group of groups) query.append('group_by[]', group)
    const result: unknown[] = [], seen = new Set<string>()
    for (let page = 0; page < 12; page++) {
      const response = await fetch(`https://api.anthropic.com/v1/organizations/${path}?${query}`, { headers: { 'x-api-key': process.env.ANTHROPIC_ADMIN_KEY!, 'anthropic-version': '2023-06-01' }, cache: 'no-store', signal: AbortSignal.any([deadline, AbortSignal.timeout(10000)]) })
      if (!response.ok) throw new Error('provider_read_failed')
      const parsed = (hourly ? usagePageSchema : costPageSchema).parse(await response.json())
      result.push(...parsed.data)
      if (!parsed.has_more) return result
      if (!parsed.next_page || seen.has(parsed.next_page)) throw new Error('invalid_pagination')
      seen.add(parsed.next_page); query.set('page', parsed.next_page)
    }
    throw new Error('page_limit')
  }
  const [usage, costs] = await Promise.all([pages('usage_report/messages', true, ['model', 'service_tier', 'inference_geo', 'speed', 'context_window']), pages('cost_report', false, ['description'])])
  return buildClaudeReport(month, usagePageSchema.shape.data.parse(usage), costPageSchema.shape.data.parse(costs), now)
}
