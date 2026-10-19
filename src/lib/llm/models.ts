import type { LlmProvider, LlmUsage } from './types'

/** Stable application references; actual provider IDs are maintained only here. */
export const MODEL_IDS = Object.freeze({
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5',
  sonnet55: 'claude-sonnet-5-5',
  opus55: 'claude-opus-5-5',
  sonnet46: 'claude-sonnet-4-6',
  opus46: 'claude-opus-4-6',
} as const)

export type LlmModel = {
  id: string
  label: string
  provider: LlmProvider
  capabilities: {
    image: boolean
    pdf: boolean
    prefixCache: boolean
    prewarm: boolean
    streaming: boolean
    temperature: boolean
    /** Application-supported output ceiling, preserving all existing requests. */
    maxOutputTokens: number
    /** Unknown context size is not treated as an unlimited verified capability. */
    contextWindowTokens: number | null
  }
  pricing: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    checkedAt: string | null
    source: string
  } | null
}

function model(id: string, label: string, temperature: boolean, rates?: { input: number; output: number }): LlmModel {
  return Object.freeze({
    id, label, provider: 'anthropic',
    capabilities: Object.freeze({ image: true, pdf: true, prefixCache: true, prewarm: true, streaming: true, temperature, maxOutputTokens: 32768, contextWindowTokens: null }),
    pricing: rates ? Object.freeze({ ...rates, cacheRead: rates.input * 0.1, cacheWrite: rates.input * 1.25, checkedAt: '2026-10-06', source: 'https://platform.claude.com/docs/en/about-claude/pricing' }) : null,
  })
}

/** Public metadata only: safe for comparison UI imports, with no SDK or keys. */
const MODEL_CATALOG: readonly LlmModel[] = Object.freeze([
  model(MODEL_IDS.haiku, 'Haiku 4.5', true, { input: 1, output: 5 }),
  model(MODEL_IDS.sonnet, 'Sonnet 5', false, { input: 2, output: 10 }),
  model(MODEL_IDS.opus, 'Opus 5', false, { input: 5, output: 25 }),
  model(MODEL_IDS.sonnet55, 'Sonnet 5.5', false),
  model(MODEL_IDS.opus55, 'Opus 5.5', false),
  model(MODEL_IDS.sonnet46, 'Sonnet 4.6', true, { input: 3, output: 15 }),
  model(MODEL_IDS.opus46, 'Opus 4.6', true, { input: 5, output: 25 }),
])

export function getModelCatalog(): readonly LlmModel[] { return MODEL_CATALOG }
export function getModel(modelId: string): LlmModel | undefined { return MODEL_CATALOG.find((entry) => entry.id === modelId) }

/** Anthropic input_tokens excludes cached tokens, so the four buckets are additive. */
export function estimateLlmCost(modelId: string, usage: LlmUsage): number | null {
  const entry = getModel(modelId)
  if (!entry?.pricing || Object.values(usage).some((tokens) => tokens === null || !Number.isFinite(tokens) || tokens < 0)) return null
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = usage
  if (inputTokens === null || outputTokens === null || cacheReadTokens === null || cacheWriteTokens === null) return null
  const rates = entry.pricing
  return (inputTokens * rates.input + outputTokens * rates.output + cacheReadTokens * rates.cacheRead + cacheWriteTokens * rates.cacheWrite) / 1_000_000
}
