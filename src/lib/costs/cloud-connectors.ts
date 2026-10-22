import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { monthBounds } from './model'

const decimal = z.union([z.string().regex(/^-?\d+(\.\d+)?$/), z.number()]).transform(Number).refine(Number.isFinite)
export const focusRowSchema = z.object({ BilledCost: decimal, BillingCurrency: z.literal('USD') })
export function parseFocusCharges(text: string) {
  return text.split('\n').filter(line => line.trim()).reduce((sum, line) => sum + focusRowSchema.parse(JSON.parse(line)).BilledCost, 0)
}
export async function fetchVercelCost(month: string) {
  const { start, end } = monthBounds(month)
  const query = new URLSearchParams({ from: start, to: end, teamId: process.env.VERCEL_BILLING_TEAM_ID! })
  const response = await fetch(`https://api.vercel.com/v1/billing/charges?${query}`, {
    headers: { Authorization: `Bearer ${process.env.VERCEL_BILLING_TOKEN}` }, cache: 'no-store', signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error('provider_read_failed')
  // Refuse very large account-wide exports rather than exhausting a server function.
  if (!response.body) throw new Error('missing_body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = '', bytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.length
      if (bytes > 10_000_000) throw new Error('report_too_large')
      text += decoder.decode(next.value, { stream: true })
    }
    text += decoder.decode()
    return parseFocusCharges(text)
  } finally { await reader.cancel().catch(() => {}) }
}
export function naverSignature(path: string, timestamp: string, access: string, secret: string) {
  return createHmac('sha256', secret).update(`GET ${path}\n${timestamp}\n${access}`).digest('base64')
}
const naverPage = z.object({ getDemandCostListResponse: z.object({
  returnCode: z.string(), totalRows: z.number().int().nonnegative(),
  demandCostList: z.array(z.object({ thisMonthAmountIncludingVat: decimal, payCurrency: z.object({ code: z.literal('KRW') }) })),
}) })
export async function fetchNaverCost(month: string) {
  monthBounds(month)
  const deadline = AbortSignal.timeout(20000)
  let amount = 0, count = 0
  for (let page = 1; page <= 20; page++) {
    const query = new URLSearchParams({ startMonth: month.replace('-', ''), endMonth: month.replace('-', ''), responseFormatType: 'json', pageNo: String(page), pageSize: '100' })
    const path = `/billing/v1/cost/getDemandCostList?${query}`
    const timestamp = String(Date.now())
    const access = process.env.NCP_BILLING_ACCESS_KEY!
    const response = await fetch(`https://billingapi.apigw.ntruss.com${path}`, { headers: {
      'x-ncp-apigw-timestamp': timestamp, 'x-ncp-iam-access-key': access,
      'x-ncp-apigw-signature-v2': naverSignature(path, timestamp, access, process.env.NCP_BILLING_SECRET_KEY!),
    }, cache: 'no-store', signal: deadline })
    if (!response.ok) throw new Error('provider_read_failed')
    const result = naverPage.parse(await response.json()).getDemandCostListResponse
    if (result.returnCode !== '0') throw new Error('provider_report_error')
    // No invoice for an unclosed month is unknown, not zero cost.
    if (result.totalRows === 0) throw new Error('invoice_not_available')
    count += result.demandCostList.length
    amount += result.demandCostList.reduce((sum, row) => sum + row.thisMonthAmountIncludingVat, 0)
    if (count >= result.totalRows) return amount
    if (!result.demandCostList.length) throw new Error('incomplete_report')
  }
  throw new Error('page_limit')
}
