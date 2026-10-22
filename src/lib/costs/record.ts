import { createServiceClient } from '../supabase/service'
import type { providers } from './model'

type Usage = { provider: typeof providers[number]; feature: string; model?: string; requestId?: string; units?: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
export function costEnvironment(): 'production' | 'development' | 'test' {
  const explicit = process.env.COST_ENVIRONMENT
  if (explicit === 'production' || explicit === 'development' || explicit === 'test') return explicit
  if (process.env.NODE_ENV === 'test') return 'test'
  return process.env.VERCEL_ENV === 'production' ? 'production' : 'development'
}
/** Await a bounded write; never log credentials, prompts, phone numbers or responses. */
export async function recordUsage(usage: Usage) {
  if (process.env.COST_TRACKING_ENABLED !== 'true') return
  try {
    const { error } = await createServiceClient().from('cost_usage_event').upsert({
      provider: usage.provider, environment: costEnvironment(), feature: usage.feature,
      model: usage.model ?? '', request_id: usage.requestId ?? crypto.randomUUID(), units: usage.units ?? 1,
      input_tokens: usage.inputTokens ?? 0, output_tokens: usage.outputTokens ?? 0,
      cache_read_tokens: usage.cacheReadTokens ?? 0, cache_write_tokens: usage.cacheWriteTokens ?? 0,
    }, { onConflict: 'provider,environment,request_id', ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(1500))
    if (error) console.warn('[costs] usage_write_failed')
  } catch { console.warn('[costs] usage_write_failed') }
}
