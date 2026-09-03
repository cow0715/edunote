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
import { jsonrepair, JSONRepairError } from 'jsonrepair'
import { fixUnescapedQuotesInJson } from '../json-lenient'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

/**
 * 역할별 모델 지정 — 새 모델이 나오면 여기만 바꾼다.
 * - parse: 시험지·답안지·해설지 PDF 파싱, Vision OCR (품질·비용 균형)
 * - explanation: 해설 추출·생성, 변형 분석 리포트 (최고 품질)
 * - light: 경량 작업 — 문자 생성, 단어 채점, 이름 판독, 예문 생성 (속도·비용)
 */
export const MODELS = {
  parse: 'claude-sonnet-5',
  explanation: 'claude-opus-5',
  light: 'claude-haiku-4-5-20251001',
} as const

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

/** 신세대(sonnet-5·opus-5·opus-4.7/4.8·fable)는 temperature 등 샘플링 파라미터가 제거됨 — 전달하면 400 */
function samplingRemoved(model: string): boolean {
  return /sonnet-5|opus-5|opus-4-[78]|fable/.test(model)
}

/** Claude 호출 후 텍스트와 usage·stop_reason 까지 반환 (비용 검증·잘림 감지용) */
export async function callClaudeTextDetailed(options: CallClaudeOptions): Promise<CallClaudeDetailedResult> {
  const params = {
    model: options.model,
    max_tokens: options.maxTokens,
    // 신세대 모델엔 temperature 를 조용히 떨군다 — 호출부가 모델 세대를 몰라도 안전하게
    ...(options.temperature !== undefined && !samplingRemoved(options.model) ? { temperature: options.temperature } : {}),
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

  // 신세대 모델(4.7+/5)은 콘텐츠 필터 거절을 에러가 아니라 정상 응답(stop_reason=refusal)으로 준다.
  // 구세대의 에러 문자열 경로와 판별을 통일하기 위해 isContentFilterError 가 인식하는 문구로 throw.
  if (res.stop_reason === 'refusal') {
    const category = (res as { stop_details?: { category?: string | null } | null }).stop_details?.category
    throw new Error(`Output blocked by content filtering (refusal${category ? `: ${category}` : ''})`)
  }

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
  // 1문항 범위 콜에서 모델이 바깥 [ ] 없이 객체만 내는 경우가 있다. 그때 첫 '[' 를 찾으면
  // 지문 속 "(A) [ making / made ]" 같은 대괄호를 잡아 엉뚱한 구간이 잘려 나온다 (실측: 항상 position 188).
  // 객체로 시작하면 그 객체(들)를 배열로 감싼다 — 쉼표 없이 이어진 객체는 jsonrepair 가 잇는다.
  if (cleaned.startsWith('{')) {
    const end = cleaned.lastIndexOf('}')
    const body = end > 0 ? cleaned.slice(0, end + 1) : cleaned
    return `[${body}]`.replace(/^\s*\/\/.*$/gm, '').trim()
  }
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
  const parsed = parseWithQuoteRecovery<T[] | T>(extractJsonArrayCandidate(raw), label)
  // 감싸기 전에 이미 배열이었으면 그대로, 단일 객체면 배열로 — 호출자는 항상 배열을 기대한다
  return Array.isArray(parsed) ? parsed : [parsed]
}

export function parseJsonObjectResponse<T>(raw: string, label = 'parseJsonObjectResponse'): T {
  return parseWithQuoteRecovery<T>(extractJsonObjectCandidate(raw), label)
}

/**
 * 모델 출력이 JSON 으로 안 읽힌 에러인지 — 콘텐츠 필터와 마찬가지로 "이 콜만" 의 문제다.
 * 범위 분할에서 이걸 문항 단위 격리로 돌리지 않으면, 한 범위의 깨진 응답이 문서 전체를
 * 통짜 폴백으로 끌고 가 max_tokens 잘림으로 뒤쪽 문항이 조용히 사라진다 (숭문 실측: 15→12문항).
 */
export function isJsonParseError(error: unknown): boolean {
  if (error instanceof JSONRepairError || error instanceof SyntaxError) return true
  const message = error instanceof Error ? error.message : String(error)
  return /Unexpected (?:character|token|end of JSON|end of input)|JSON at position|is not valid JSON/i.test(message)
}

/** Anthropic 콘텐츠 필터로 출력이 차단된 에러인지 (페이지 단위 재시도 분기용) */
export function isContentFilterError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Output blocked') || message.includes('content filtering')
}
