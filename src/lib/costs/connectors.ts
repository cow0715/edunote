import { z } from 'zod'
import { monthBounds } from './model'

const reportSchema = z.object({
  data: z.array(z.object({ results: z.array(z.object({ amount: z.string().regex(/^\d+(\.\d+)?$/), currency: z.string() })) })),
  has_more: z.boolean(), next_page: z.string().nullable().optional(),
})
export function parseClaudeCostPage(raw: unknown) {
  const page = reportSchema.parse(raw)
  let dollars = 0
  for (const bucket of page.data) for (const row of bucket.results) {
    if (row.currency.toUpperCase() !== 'USD') throw new Error('unsupported_currency')
    const value = Number(row.amount) / 100
    if (!Number.isFinite(value)) throw new Error('invalid_amount')
    dollars += value
  }
  if (page.has_more && !page.next_page) throw new Error('missing_page')
  return { dollars, next: page.has_more ? page.next_page : null }
}
export async function fetchClaudeCost(month: string) {
  const deadline = AbortSignal.timeout(20000)
  const { start, end } = monthBounds(month)
  const query = new URLSearchParams({ starting_at: start, ending_at: end, limit: '31' })
  let total = 0
  const seen = new Set<string>()
  for (let i = 0; i < 30; i++) {
    const response = await fetch(`https://api.anthropic.com/v1/organizations/cost_report?${query}`, {
      headers: { 'x-api-key': process.env.ANTHROPIC_ADMIN_KEY!, 'anthropic-version': '2023-06-01' },
      cache: 'no-store', signal: AbortSignal.any([deadline, AbortSignal.timeout(8000)]),
    })
    if (!response.ok) throw new Error('provider_read_failed')
    const page = parseClaudeCostPage(await response.json())
    total += page.dollars
    if (!page.next) return total
    if (seen.has(page.next)) throw new Error('repeated_page')
    seen.add(page.next); query.set('page', page.next)
  }
  throw new Error('page_limit')
}
