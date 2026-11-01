import type { UsageGroup } from './model'

export const PRICING_CHECKED_AT = '2026-11-01'
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
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
}

export function claudeTokenCost(model: string, tokens: { input: number; output: number; read: number; write: number; writeHour?: number }, options: { tier?: string | null; geo?: string | null; speed?: string | null; context?: string | null } = {}) {
  const canonical = model.replace(/-\d{8}$/, '')
  const price = rates[canonical]
  const values = [tokens.input, tokens.output, tokens.read, tokens.write, tokens.writeHour ?? 0]
  if (!price || values.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) return null
  if (options.tier && !['standard', 'batch'].includes(options.tier)) return null
  if (options.geo && !['global', 'us', 'not_available'].includes(options.geo)) return null
  if (options.speed && !['standard', 'fast'].includes(options.speed)) return null
  if (options.context === '200k-1M' && /(?:sonnet|opus)-4-5|haiku-4/.test(canonical)) return null
  if (options.speed === 'fast' && !['claude-opus-5', 'claude-opus-5-5'].includes(canonical)) return null
  // Prompt length is per request and includes both cache-write buckets and hits.
  const longHaiku = canonical === 'claude-haiku-5-5' && tokens.input + tokens.read + tokens.write + (tokens.writeHour ?? 0) > 100_000
  const factor = (options.tier === 'batch' ? 0.5 : 1) * (options.geo === 'us' ? 1.1 : 1) * (options.speed === 'fast' ? 2 : 1) * (longHaiku ? 5 : 1)
  return (values[0] * price[0] + values[1] * price[1] + values[2] * price[2] + values[3] * price[3] + values[4] * price[0] * 2) / 1_000_000 * factor
}

export type UsageEstimate = { row: UsageGroup; amount: number | null; currency: 'USD' | 'KRW'; reason: string | null }

/** Missing/unknown buckets are excluded, never silently priced as zero. No FX conversion. */
export function estimateUsageRow(row: UsageGroup): UsageEstimate | null {
  if (row.provider === 'claude') {
    if (row.model.replace(/-\d{8}$/, '') === 'claude-haiku-5-5' && row.estimated_usd !== undefined) {
      const amount = typeof row.estimated_usd === 'number' && Number.isFinite(row.estimated_usd) && row.estimated_usd >= 0 ? row.estimated_usd : null
      return { row, amount, currency: 'USD', reason: amount === null ? 'Haiku 요청별 비용 기록 확인 필요' : null }
    }
    // Aggregated short prompts must not accidentally enter the long-prompt tier.
    // The file's authoritative Batch ledger prices each request independently.
    if (row.model.replace(/-\d{8}$/, '') === 'claude-haiku-5-5' && row.calls > 1
      && row.input_tokens + row.cache_read_tokens + row.cache_write_tokens > 100_000) {
      return { row, amount: null, currency: 'USD', reason: 'Haiku 요청별 길이 구간 확인 필요 · 파일별 Batch 비용 기록에서 확인' }
    }
    const amount = claudeTokenCost(row.model, { input: row.input_tokens, output: row.output_tokens, read: row.cache_read_tokens, write: row.cache_write_tokens }, { tier: row.service_tier ?? 'standard' })
    return { row, amount, currency: 'USD', reason: amount === null ? '모델 단가·토큰 기록 확인 필요' : null }
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
