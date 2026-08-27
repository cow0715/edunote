/**
 * Claude 호출 공용 계층.
 * - buildFileBlock: base64 파일 → image/document 블록 (mime 검증 포함)
 * - callClaudeText: 호출 + 텍스트 블록 병합 반환 (긴 출력은 stream 옵션)
 * - parseJsonArrayResponse / parseJsonObjectResponse: 펜스 제거 → jsonrepair →
 *   실패 시 지문 속 미이스케이프 따옴표 보정(json-lenient) 2차 시도.
 *   모든 LLM JSON 응답은 이 두 함수를 거쳐야 2단 복구를 받는다.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { DocumentBlockParam, ImageBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import { jsonrepair } from 'jsonrepair'
import { fixUnescapedQuotesInJson } from '../json-lenient'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export type FileBlock = DocumentBlockParam | ImageBlockParam
export type ContentBlock = FileBlock | TextBlockParam

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

/** base64 파일 → Claude 콘텐츠 블록. PDF/이미지 외에는 throw. */
export function buildFileBlock(
  fileData: string,
  mimeType: string,
  errorMessage = '지원하지 않는 파일 형식입니다 (PDF 또는 이미지만 가능)',
): FileBlock {
  if (mimeType.startsWith('image/')) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: mimeType as ImageMediaType, data: fileData },
    }
  }
  if (mimeType === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: fileData },
    }
  }
  throw new Error(errorMessage)
}

export type CallClaudeOptions = {
  model: string
  maxTokens: number
  /** 문자열이면 텍스트 단일 메시지, 배열이면 블록 그대로 */
  content: string | ContentBlock[]
  temperature?: number
  /** 출력이 큰 호출(기출 파싱 등)은 스트리밍으로 — 장시간 응답의 연결 유지 */
  stream?: boolean
}

export type CallClaudeUsage = {
  inputTokens: number
  outputTokens: number
  /** 프롬프트 캐시에서 읽은 토큰 (0.1배 과금). 0이면 캐시 미적중 */
  cacheReadTokens: number
  /** 프롬프트 캐시에 새로 쓴 토큰 (1.25배 과금) */
  cacheWriteTokens: number
}

export type CallClaudeDetailedResult = {
  text: string
  usage: CallClaudeUsage
  stopReason: string | null
}

/** Claude 호출 후 텍스트와 usage·stop_reason 까지 반환 (비용 검증·잘림 감지용) */
export async function callClaudeTextDetailed(options: CallClaudeOptions): Promise<CallClaudeDetailedResult> {
  const params = {
    model: options.model,
    max_tokens: options.maxTokens,
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    messages: [{ role: 'user' as const, content: options.content }],
  }

  const res = options.stream
    ? await (await anthropic.messages.stream(params)).finalMessage()
    : await anthropic.messages.create(params)

  const usage: CallClaudeUsage = {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
  }
  console.log(`[llm] ${options.model} in=${usage.inputTokens} out=${usage.outputTokens} cache_read=${usage.cacheReadTokens} cache_write=${usage.cacheWriteTokens} stop=${res.stop_reason}`)

  return {
    text: res.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n'),
    usage,
    stopReason: res.stop_reason,
  }
}

/** Claude 호출 후 텍스트 블록을 모두 이어붙여 반환 */
export async function callClaudeText(options: CallClaudeOptions): Promise<string> {
  return (await callClaudeTextDetailed(options)).text
}

export function extractJsonArrayCandidate(raw: string): string {
  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
  return candidate.replace(/^\s*\/\/.*$/gm, '').trim()
}

export function extractJsonObjectCandidate(raw: string): string {
  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
}

function parseWithQuoteRecovery<T>(candidate: string, label: string): T {
  try {
    return JSON.parse(jsonrepair(candidate)) as T
  } catch (error) {
    // 문자열 값 안의 이스케이프 안 된 큰따옴표(지문 속 대화 등) — jsonrepair 가 못 고치는 케이스.
    // 실패했을 때만 한 번 더 시도하므로 정상 응답 경로는 그대로.
    try {
      const parsed = JSON.parse(jsonrepair(fixUnescapedQuotesInJson(candidate))) as T
      console.warn(`[${label}] 문자열 안 따옴표 복구 후 파싱 성공`)
      return parsed
    } catch {
      throw error
    }
  }
}

export function parseJsonArrayResponse<T>(raw: string, label = 'parseJsonArrayResponse'): T[] {
  return parseWithQuoteRecovery<T[]>(extractJsonArrayCandidate(raw), label)
}

export function parseJsonObjectResponse<T>(raw: string, label = 'parseJsonObjectResponse'): T {
  return parseWithQuoteRecovery<T>(extractJsonObjectCandidate(raw), label)
}

/** Anthropic 콘텐츠 필터로 출력이 차단된 에러인지 (페이지 단위 재시도 분기용) */
export function isContentFilterError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Output blocked') || message.includes('content filtering')
}
