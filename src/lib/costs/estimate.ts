import type { UsageGroup } from './model'

export const PRICING_CHECKED_AT = '2026-10-22'
export const CLAUDE_PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing'
export const CLOVA_PRICING_URL = 'https://m.ncloud.com/charge/price/ko'

// USD per million tokens: input, output, cache read, five-minute cache write.
// Keep this separate from inference routing: these rates describe recorded usage only.
const rates: Record<string, readonly [number, number, number, number]> = {
  'claude-sonnet-5-5': [2, 10, 0.1, 2.5],
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5': [2, 10, 0.2, 2.5],
  'claude-opus-5': [5, 25, 0.5, 6.25],
  'claude-sonnet-4-6': [3, 15, 0.3, 3.75],
  'claude-sonnet-4-5': [3, 15, 0.3, 3.75],
  'claude-opus-4-6': [5, 25, 0.5, 6.25],
  'claude-opus-4-5': [5, 25, 0.5, 6.25],
  'claude-haiku-4-5': [1, 5, 0.1, 1.25],
}

export type UsageEstimate = { row: UsageGroup; amount: number | null; currency: 'USD' | 'KRW'; reason: string | null }

/** Missing/unknown buckets are excluded, never silently priced as zero. No FX conversion. */
export function estimateUsageRow(row: UsageGroup): UsageEstimate | null {
  if (row.provider === 'claude') {
    const price = rates[row.model.replace(/-\d{8}$/, '')]
    const buckets = [row.input_tokens, row.output_tokens, row.cache_read_tokens, row.cache_write_tokens]
    if (!price || buckets.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) {
      return { row, amount: null, currency: 'USD', reason: price ? '토큰 기록 확인 필요' : '모델 단가 미등록' }
    }
    return { row, amount: buckets.reduce((sum, tokens, i) => sum + tokens * price[i], 0) / 1_000_000, currency: 'USD', reason: null }
  }
  if (row.provider === 'naver') {
    // The app sends one General text OCR image per request. Legacy events count requests,
    // including failed responses/PDF requests; this is a gross usage estimate, not an invoice.
    const known = row.feature === '단어시험 사진 OCR 요청'
    const valid = typeof row.units === 'number' && Number.isFinite(row.units) && row.units >= 0
    return { row, amount: known && valid ? row.units * 3 : null, currency: 'KRW', reason: !known ? 'OCR 상품 단가 확인 필요' : !valid ? '요청 수 확인 필요' : null }
  }
  return null
}

export function estimateUsage(rows: UsageGroup[], provider: 'claude' | 'naver') {
  const items = rows.filter(row => row.provider === provider).map(estimateUsageRow).filter((item): item is UsageEstimate => item !== null)
  const priced = items.filter(item => item.amount !== null)
  return {
    items,
    amount: priced.length ? priced.reduce((sum, item) => sum + item.amount!, 0) : null,
    currency: provider === 'claude' ? 'USD' as const : 'KRW' as const,
    excludedCalls: items.filter(item => item.amount === null).reduce((sum, item) => sum + (Number.isFinite(item.row.calls) ? item.row.calls : 0), 0),
    calls: items.reduce((sum, item) => sum + (Number.isFinite(item.row.calls) ? item.row.calls : 0), 0),
    units: items.reduce((sum, item) => sum + (Number.isFinite(item.row.units) ? item.row.units : 0), 0),
  }
}

export function estimateMoney(amount: number, currency: 'USD' | 'KRW') {
  if (currency === 'USD' && amount > 0 && amount < 0.0001) return '< US$0.0001'
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency, minimumFractionDigits: currency === 'USD' ? 2 : 0, maximumFractionDigits: currency === 'USD' ? 4 : 0 }).format(amount)
}
