import Anthropic from '@anthropic-ai/sdk'
import type { ContentBlockParam, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages'
import { LlmError, isContentFilterError } from '../errors'
import type { LlmModel } from '../models'
import type { CallLlmOptions, LlmErrorKind, LlmFinishReason, ProviderResult } from '../types'

if (typeof window !== 'undefined') throw new LlmError('configuration', 'LLM 공급사 연결부는 서버에서만 사용할 수 있습니다.')

/** No client construction (and no key requirement) during module import. */
export function isAnthropicConfigured(): boolean { return Boolean(process.env.ANTHROPIC_API_KEY) }

export function buildAnthropicRequest(options: CallLlmOptions, model: LlmModel): MessageCreateParamsNonStreaming {
  const content = typeof options.content === 'string' ? options.content : options.content.map((block, index): ContentBlockParam => {
    const cache = index === options.cacheBoundary ? { cache_control: { type: 'ephemeral' as const } } : {}
    if (block.type === 'text') return { type: 'text', text: block.text, ...cache }
    if (block.type === 'image') return { type: 'image', source: { type: 'base64', media_type: block.mimeType, data: block.data }, ...cache }
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: block.data }, ...cache }
  })
  return {
    model: model.id,
    max_tokens: options.phase === 'prewarm' ? 0 : options.maxTokens,
    ...(options.temperature !== undefined && model.capabilities.temperature ? { temperature: options.temperature } : {}),
    messages: [{ role: 'user', content }],
  }
}

function finishReason(stopReason: string | null): LlmFinishReason {
  if (stopReason === 'end_turn' || stopReason === 'stop_sequence') return 'complete'
  if (stopReason === 'max_tokens') return 'length'
  if (stopReason === 'refusal') return 'refusal'
  return 'other'
}

function providerError(error: unknown): LlmError {
  if (error instanceof LlmError) return error
  const value = error && typeof error === 'object' ? error as { status?: number; name?: string; message?: string } : {}
  const message = error instanceof Error ? error.message : String(error)
  let kind: LlmErrorKind = 'provider'
  if (isContentFilterError(error)) kind = 'refusal'
  else if (value.status === 401 || value.status === 403) kind = 'authentication'
  else if (value.status === 429) kind = 'rate_limit'
  else if (value.status === 413 || /context.{0,20}(?:length|limit)|too many tokens|prompt is too long/i.test(message)) kind = 'input_limit'
  else if (value.name === 'APIConnectionTimeoutError') kind = 'timeout'
  else if (value.name === 'APIUserAbortError' || value.name === 'AbortError') kind = 'cancelled'
  else if (value.name === 'APIConnectionError') kind = 'network'
  return new LlmError(kind, message, { cause: error })
}

export async function callAnthropic(options: CallLlmOptions, model: LlmModel): Promise<ProviderResult> {
  if (!isAnthropicConfigured()) throw new LlmError('configuration', 'ANTHROPIC_API_KEY가 설정되지 않았습니다.')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const params = buildAnthropicRequest(options, model)
  try {
    // Keep SDK retry defaults and collect the same final message for buffered streaming.
    const requestOptions = options.signal ? { signal: options.signal } : undefined
    const res = options.stream
      ? await client.messages.stream(params, requestOptions).finalMessage()
      : await client.messages.create(params, requestOptions)
    return {
      text: res.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n'),
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      },
      stopReason: res.stop_reason,
      finishReason: finishReason(res.stop_reason),
      responseModel: res.model ?? null,
    }
  } catch (error) { throw providerError(error) }
}
